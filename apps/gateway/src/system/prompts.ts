import { join, resolve } from 'node:path'
import { readdir } from 'node:fs/promises'

export default class PromptsManager {
  private readonly promptDir: string;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(basedir: string) {
    this.promptDir = join(basedir, 'prompts');
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

  private resolvePath(name: string): string {
    if (name.includes('/') || name.includes('\\') || name.includes('..')) {
      throw new Error('Invalid prompt name: ' + name);
    }
    const filename = name.endsWith('.md') ? name : name + '.md';
    const resolved = resolve(this.promptDir, filename);
    if (!resolved.startsWith(this.promptDir)) {
      throw new Error('Invalid prompt name');
    }
    return resolved;
  }

  async list(): Promise<string[]> {
    const files = await readdir(this.promptDir);
    return files.filter(f => f.endsWith('.md'));
  }

  async read(name: string): Promise<string> {
    const filepath = this.resolvePath(name);
    const file = Bun.file(filepath);
    if (!(await file.exists())) {
      throw new Error('Prompt not found: ' + name);
    }
    return await file.text();
  }

  async create(name: string, content: string): Promise<void> {
    return this.enqueueWrite(async () => {
      const filepath = this.resolvePath(name);
      const file = Bun.file(filepath);
      if (await file.exists()) {
        throw new Error('Prompt already exists: ' + name);
      }
      await file.write(content);
    });
  }

  async update(name: string, content: string): Promise<void> {
    return this.enqueueWrite(async () => {
      const filepath = this.resolvePath(name);
      const file = Bun.file(filepath);
      if (!(await file.exists())) {
        throw new Error('Prompt not found: ' + name);
      }
      await file.write(content);
    });
  }

  async delete(name: string): Promise<void> {
    return this.enqueueWrite(async () => {
      const filepath = this.resolvePath(name);
      const file = Bun.file(filepath);
      if (!(await file.exists())) {
        throw new Error('Prompt not found: ' + name);
      }
      await file.unlink();
    });
  }
}
