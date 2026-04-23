import { join } from 'node:path'
import { ModelConfig } from "../types";


export default class ModelsManager {
  private filepath: string;
  models: Record<string, ModelConfig> = {};

  constructor(path: string) {
    this.filepath = join(path, "models.json")
  }

  async init() {
    const { default: mymodels } = await import(this.filepath)
    this.models = mymodels
  }

  load(name: string) {
    return this.models[name]
  }
}



