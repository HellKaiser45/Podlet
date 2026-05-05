import { join } from 'node:path'
import { ModelConfig } from "../types"
import { SerialQueue } from "../utils/serial-queue"


export default class ModelsManager {
  private filepath: string;
  models: Record<string, ModelConfig> = {};
  private serialQueue = new SerialQueue();

  constructor(path: string) {
    this.filepath = join(path, "models.json")
  }


  async init() {
    const file = Bun.file(this.filepath);
    if (!(await file.exists())) {
      this.models = {};
      return;
    }
    this.models = await file.json();
  }

  load(name: string) {
    return this.models[name]
  }

  async create(name: string, config: ModelConfig): Promise<ModelConfig> {
    return this.serialQueue.enqueue(async () => {
      if (this.models[name]) {
        throw new Error('Model already exists: ' + name);
      }
      this.models[name] = config;
      await this.save();
      return config;
    });
  }

  async update(name: string, partial: Partial<ModelConfig>): Promise<ModelConfig> {
    return this.serialQueue.enqueue(async () => {
      if (!this.models[name]) {
        throw new Error('Model not found: ' + name);
      }
      this.models[name] = { ...this.models[name], ...partial };
      await this.save();
      return this.models[name];
    });
  }

  async delete(name: string): Promise<void> {
    return this.serialQueue.enqueue(async () => {
      if (!this.models[name]) {
        throw new Error('Model not found: ' + name);
      }
      delete this.models[name];
      await this.save();
    });
  }

  private async save(): Promise<void> {
    await Bun.write(this.filepath, JSON.stringify(this.models, null, 2));
  }
}
