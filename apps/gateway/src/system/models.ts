import { join } from 'node:path'
import { Health, ModelConfig, ModelWithHealth } from "../types"
import { SerialQueue } from "../utils/serial-queue"
import { resolveModel, ResolvedModel } from "./providers"


export default class ModelsManager {
  private filepath: string;
  models: Record<string, ModelConfig> = {};
  /** Parallel to `models`; never a field on the stored config (save() writes that verbatim). */
  health: Record<string, Health> = {};
  /** File-level failure (parse error, wrong top-level shape). Nothing is retained after one. */
  fileError?: string;
  /**
   * mtime of our own last write. The file watcher in runtime.ts debounces by
   * 500 ms, so a boolean "skip the next re-read" flag would already have been
   * cleared by the time init() runs -- compare mtimes instead.
   */
  private lastSelfWriteAt = 0;
  private serialQueue = new SerialQueue();

  constructor(path: string) {
    this.filepath = join(path, "models.json")
  }


  async init() {
    const file = Bun.file(this.filepath);
    if (!(await file.exists())) {
      this.models = {};
      this.health = {};
      this.fileError = undefined;
      return;
    }

    const stat = await file.stat();
    // Our own save() bumped the mtime; the watcher firing afterwards is not an
    // external edit, so do not re-read (and do not lose in-memory state to it).
    if (this.lastSelfWriteAt !== 0 && stat.mtime.getTime() <= this.lastSelfWriteAt) {
      return;
    }

    let parsed: unknown;
    try {
      parsed = await file.json();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.models = {};
      this.health = {};
      this.fileError = `models.json: ${msg}`;
      console.error(`[ModelsManager] ${this.fileError}`);
      return;
    }

    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      this.models = {};
      this.health = {};
      this.fileError = "models.json: expected a JSON object mapping model names to configs";
      console.error(`[ModelsManager] ${this.fileError}`);
      return;
    }

    this.fileError = undefined;
    // Entries are kept verbatim, even unusable ones: nothing is silently dropped.
    this.models = parsed as Record<string, ModelConfig>;
    this.reclassify(process.env, true);
  }

  /** Response envelope for GET /models/all: the stored config plus its health. */
  getAll(env: Record<string, string | undefined> = process.env): Record<string, ModelWithHealth> {
    this.reclassify(env, false);
    const out: Record<string, ModelWithHealth> = {};
    for (const [name, config] of Object.entries(this.models)) {
      out[name] = { ...config, health: this.health[name] ?? { status: "unusable", reason: `model '${name}': not classified` } };
    }
    return out;
  }

  load(name: string) {
    return this.models[name]
  }

  /**
   * Request-time classification: a key added to `.env` after boot makes a
   * previously unusable model usable, so health is recomputed on demand.
   */
  resolve(name: string, env: Record<string, string | undefined> = process.env): ResolvedModel | undefined {
    const entry = this.models[name];
    if (!entry) return undefined;
    const resolved = resolveModel(name, entry, env);
    this.health[name] = resolved.health;
    return resolved;
  }

  /** Recompute health against the current process env (e.g. after .env changed). */
  refreshHealth(env: Record<string, string | undefined> = process.env): void {
    this.reclassify(env, true);
  }

  async create(name: string, config: ModelConfig): Promise<ModelConfig> {
    return this.serialQueue.enqueue(async () => {
      if (this.models[name]) {
        throw new Error('Model already exists: ' + name);
      }
      const stored = stripLegacyFields(config);
      this.models[name] = stored;
      this.reclassify(process.env, true);
      await this.save();
      return stored;
    });
  }

  async update(name: string, partial: Partial<ModelConfig>): Promise<ModelConfig> {
    return this.serialQueue.enqueue(async () => {
      if (!this.models[name]) {
        throw new Error('Model not found: ' + name);
      }
      // A stored legacy value must not survive a later partial PUT (D9): the
      // merge would otherwise carry it forward untouched.
      const merged = stripLegacyFields({ ...this.models[name], ...partial });
      this.models[name] = merged;
      this.reclassify(process.env, true);
      await this.save();
      return merged;
    });
  }

  async delete(name: string): Promise<void> {
    return this.serialQueue.enqueue(async () => {
      if (!this.models[name]) {
        throw new Error('Model not found: ' + name);
      }
      delete this.models[name];
      delete this.health[name];
      await this.save();
    });
  }

  private reclassify(env: Record<string, string | undefined>, log: boolean): void {
    this.health = {};
    for (const [name, entry] of Object.entries(this.models)) {
      const { health } = resolveModel(name, entry, env);
      this.health[name] = health;
      if (log && health.status !== "ok") {
        console.error(`[ModelsManager] model '${name}' is ${health.status}: ${health.reason}`);
      }
    }
  }

  private async save(): Promise<void> {
    await Bun.write(this.filepath, JSON.stringify(this.models, null, 2));
    const stat = await Bun.file(this.filepath).stat();
    this.lastSelfWriteAt = stat.mtime.getTime();
  }
}

/** `reasoning_effort` moved to the agent (`agent.thinking`); `protocol` is not a model setting. Neither is persisted. */
function stripLegacyFields<T extends object>(config: T): T {
  const next = { ...config };
  delete (next as Record<string, unknown>).reasoning_effort;
  delete (next as Record<string, unknown>).protocol;
  return next;
}