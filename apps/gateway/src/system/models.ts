import { join } from 'node:path'
import { ModelConfig } from "../types"


export default class ModelsManager {
  private filepath: string;
  models: Record<string, ModelConfig> = {};
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(path: string) {
    this.filepath = join(path, "models.json")
  }

  private async enqueueWrite<T>(fn: () => Promise<T>): Promise<T> {
    let resolve: () => void;
    const prev = this.writeQueue;
    this.writeQueue = new Promise<void>(r => { resolve = r; });
    await prev;
    try {
      return await fn();
    } finally {
      resolve!();
    }
  }

  async init() {
    const { default: mymodels } = await import(this.filepath)
    this.models = mymodels
  }

  load(name: string) {
    return this.models[name]
  }

  async create(name: string, config: ModelConfig): Promise<ModelConfig> {
    return this.enqueueWrite(async () => {
      if (this.models[name]) {
        throw new Error('Model already exists: ' + name);
      }
      this.models[name] = config;
      await this.save();
      return config;
    });
  }

  async update(name: string, partial: Partial<ModelConfig>): Promise<ModelConfig> {
    return this.enqueueWrite(async () => {
      if (!this.models[name]) {
        throw new Error('Model not found: ' + name);
      }
      this.models[name] = { ...this.models[name], ...partial };
      await this.save();
      return this.models[name];
    });
  }

  async delete(name: string): Promise<void> {
    return this.enqueueWrite(async () => {
      if (!this.models[name]) {
        throw new Error('Model not found: ' + name);
      }
      delete this.models[name];
      await this.save();
    });
  }

  private async save(): Promise<void> {
    await Bun.file(this.filepath).write(JSON.stringify(this.models, null, 2));
  }
}
