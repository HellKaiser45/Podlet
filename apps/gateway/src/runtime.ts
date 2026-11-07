import { AgentClient } from "./agent_client";
import { createDB } from "./db/db";
import { FrameCRUDClient } from "./db/db_client";
import { AgentOrchestrator } from "./orchestrator";
import AgentsManager from "./system/agents";
import ModelsManager from "./system/models";
import SkillsManager from "./system/skills";
import MCPManager from "./tools/mcp/client";
import { AppConfig } from '@podlet/types';
import { join } from "path";
import { watch, FSWatcher } from 'fs'
import { readdir, rm } from 'node:fs/promises'
import createfilesystem from "./system/files";
import { AgentToolManager } from "./tools/agents-as-tools";
import { AgentEventStream } from "./stream_handler";
import { HilManager } from "./hil/hil-manager";
import { HistoryCRUDClient } from "./db/db_history_client";
import { UsageCRUDClient } from "./db/db_usage_client";
import type { UsageRecord } from "./llm/usage";
import PromptsManager from "./system/prompts";
import { applyEnvFile } from "./system/env";

export default class AppContainer {
  frameCRUD: FrameCRUDClient;
  agentClient: AgentClient;
  mcpManager: MCPManager;
  modelManager: ModelsManager
  skillManager: SkillsManager;
  orchestrator: AgentOrchestrator;
  hillManager: HilManager;
  agentManager: AgentsManager;
  promptManager: PromptsManager;
  initConfig: AppConfig;
  agentToolsManager: AgentToolManager;
  historyManager: HistoryCRUDClient;
  usageManager: UsageCRUDClient;
  eventManager: Record<string, AgentEventStream> = {}
  /**
   * Fire-and-forget sink for one LLM call's usage. Never awaited by the caller:
   * a failed write must log and must not change the run's outcome.
   */
  usageSink: (record: UsageRecord) => void;
  private watchers: FSWatcher[] = [];
  private snapshotTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(appconfig: AppConfig) {
    this.initConfig = appconfig
    const db = createDB(appconfig.podletDir, appconfig.dbName)
    this.frameCRUD = new FrameCRUDClient(db)
    this.historyManager = new HistoryCRUDClient(db)
    this.usageManager = new UsageCRUDClient(db)
    this.usageSink = (rec) => {
      void this.usageManager.record(rec)
        .then(() => this.scheduleUsageSnapshot(rec.runId))
        .catch(err => console.error('[usage] write failed', err));
    }
    this.hillManager = new HilManager(appconfig.safemode)
    this.mcpManager = new MCPManager(appconfig.podletDir)
    this.modelManager = new ModelsManager(appconfig.podletDir)
    this.skillManager = new SkillsManager(appconfig.podletDir)
    this.agentManager = new AgentsManager(appconfig.podletDir)
    this.promptManager = new PromptsManager(appconfig.podletDir)
    this.agentToolsManager = new AgentToolManager(this)
    this.agentClient = new AgentClient(this)
    this.orchestrator = new AgentOrchestrator(this)
  }

  async init() {
    await createfilesystem(this.initConfig.podletDir)

    // Before modelManager.init(): classification reads process.env, so the
    // `.env` stub has to be in the environment first. Malformed lines are
    // reported here exactly like the watcher path does, so a bad `.env` never
    // fails silently at boot.
    const { warnings } = await applyEnvFile(this.initConfig.podletDir)
    for (const w of warnings) console.error(`[env] ${w}`)

    await this.collectOrphanedRunDirs()

    await Promise.all([
      this.mcpManager.init(),
      this.skillManager.LoadSkillsDefs(),
      this.modelManager.init(),
      this.agentManager.loadAll(),
    ])
    // PromptsManager has no async init needed -- it reads files on-demand

    await this.startwatchers()
  }

  /**
   * Startup garbage collection: delete per-run directories under workspace/,
   * artifacts/ and runs/ whose runId has no matching run_history row (e.g. chats
   * that were opened but never received a first message). Only UUID-shaped
   * directory names are considered, so any non-run folder placed there
   * deliberately is never touched. The workspace/ and artifacts/ sweeps also
   * collect leftovers from the pre-run-root layout.
   */
  private async collectOrphanedRunDirs(): Promise<void> {
    const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    for (const schemeDir of ['workspace', 'artifacts', 'runs']) {
      const dirPath = join(this.initConfig.podletDir, schemeDir);

      let entries;
      try {
        entries = await readdir(dirPath, { withFileTypes: true });
      } catch {
        continue; // scheme dir doesn't exist yet -- nothing to collect
      }

      for (const entry of entries) {
        if (!entry.isDirectory() || !UUID_PATTERN.test(entry.name)) continue;
        if (await this.historyManager.exists(entry.name)) continue;

        console.log(`[GC] Removing orphaned ${schemeDir}/ directory with no chat history: ${entry.name}`);
        try {
          await rm(join(dirPath, entry.name), { recursive: true, force: true });
        } catch (err) {
          console.error(`[GC] Failed to remove orphaned ${schemeDir}/${entry.name}:`, err);
        }
      }
    }
  }

  private debounce(key: string, fn: () => Promise<void>, ms: number): () => void {
    let timer: ReturnType<typeof setTimeout> | undefined;
    return () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        fn();
      }, ms);
    };
  }

  /**
   * Debounce per run id. `debounce()` above cannot be reused: it ignores its
   * `key` argument and returns a fresh closure on every call, so it debounces
   * nothing across runs.
   */
  private scheduleUsageSnapshot(runId: string): void {
    const existing = this.snapshotTimers.get(runId);
    if (existing) clearTimeout(existing);

    this.snapshotTimers.set(runId, setTimeout(() => {
      this.snapshotTimers.delete(runId);
      void this.emitUsageSnapshot(runId).catch(err =>
        console.error('[usage] snapshot failed', err));
    }, 250));
  }

  // TODO phase 4.2: emit a CUSTOM USAGE_SNAPSHOT event through eventManager.
  private async emitUsageSnapshot(runId: string): Promise<void> {
    const totals = await this.usageManager.totals(runId);
    console.log(
      `[usage] run=${runId} calls=${totals.run.calls} total=${totals.run.total}` +
        ` reported=${totals.reported} requested=${totals.requested}`,
    );
  }

  private async startwatchers() {
    this.watchers.push(
      watch(join(this.initConfig.podletDir, 'skills'), { recursive: true },
        this.debounce('skills', async () => await this.skillManager.LoadSkillsDefs(), 500))
    );

    this.watchers.push(
      watch(join(this.initConfig.podletDir, 'models.json'),
        this.debounce('models', async () => await this.modelManager.init(), 500))
    );

    this.watchers.push(
      watch(join(this.initConfig.podletDir, 'mcp.json'),
        this.debounce('mcps', async () => await this.mcpManager.init(), 500))
    );

    this.watchers.push(
      watch(join(this.initConfig.podletDir, 'agents'), { recursive: true },
        this.debounce('agents', async () => await this.agentManager.reload(), 500))
    );

    this.watchers.push(
      watch(join(this.initConfig.podletDir, '.env'),
        this.debounce('env', async () => {
          const { warnings } = await applyEnvFile(this.initConfig.podletDir);
          for (const w of warnings) console.error(`[env] ${w}`);
          this.modelManager.refreshHealth();
        }, 500))
    );
  }

  async cleanup() {
    // A pending 250 ms snapshot timer must never fire against an exiting
    // process: it would hold the event loop open and query a closed database.
    for (const timer of this.snapshotTimers.values()) clearTimeout(timer);
    this.snapshotTimers.clear();

    this.watchers.forEach(w => w.close());
    await this.mcpManager.stopAll();
  }
}
