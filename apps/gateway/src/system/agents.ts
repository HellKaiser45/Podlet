import { readdir } from "node:fs/promises";
import { join } from 'node:path'
import { Agent } from "../types"


export default class AgentsManager {
  private readonly agentsDir: string;
  private readonly promptDir: string;
  agents: Record<string, Agent> = {}
  private agentIdToFilename: Map<string, string> = new Map();
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(basedir: string) {
    this.agentsDir = join(basedir, 'agents');
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

  async loadAll() {
    this.agents = {};
    this.agentIdToFilename.clear();

    const allFiles = await readdir(this.agentsDir);
    const filePaths = allFiles.filter(f => f.endsWith('.json'));

    const results = await Promise.all(
      filePaths.map(filePath => import(join(this.agentsDir, filePath)))
    );

    for (let i = 0; i < results.length; i++) {
      const agent = results[i].default as Agent;
      this.agents[agent.agentId] = agent;
      this.agentIdToFilename.set(agent.agentId, filePaths[i]);
    }
  }

  async getAgentprompt(agentId: string) {
    const path = this.agents[agentId].system_prompt


    const { default: prompt } = await import(join(this.promptDir, path), { with: { type: "text" } })

    return prompt
  }

  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash).toString(36);
  }

  private toFilename(agentId: string): string {
    const slug = agentId.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const hash = this.simpleHash(agentId);
    return `${slug}-${hash}.json`;
  }

  async create(agent: Agent): Promise<Agent> {
    return this.enqueueWrite(async () => {
      if (this.agents[agent.agentId]) {
        throw new Error('Agent already exists: ' + agent.agentId);
      }
      const filename = this.toFilename(agent.agentId);
      const filepath = join(this.agentsDir, filename);
      await Bun.file(filepath).write(JSON.stringify(agent, null, 2));
      this.agents[agent.agentId] = agent;
      this.agentIdToFilename.set(agent.agentId, filename);
      return agent;
    });
  }

  async update(agentId: string, partial: Partial<Agent>): Promise<Agent> {
    return this.enqueueWrite(async () => {
      const existing = this.agents[agentId];
      if (!existing) {
        throw new Error('Agent not found: ' + agentId);
      }
      const { agentId: _, ...safePartial } = partial;
      const updated = { ...existing, ...safePartial };
      const filename = this.agentIdToFilename.get(agentId);
      if (!filename) {
        throw new Error('Agent file not found: ' + agentId);
      }
      const filepath = join(this.agentsDir, filename);
      await Bun.file(filepath).write(JSON.stringify(updated, null, 2));
      this.agents[agentId] = updated;
      return updated;
    });
  }

  async delete(agentId: string): Promise<void> {
    return this.enqueueWrite(async () => {
      const filename = this.agentIdToFilename.get(agentId);
      if (!filename) {
        throw new Error('Agent not found: ' + agentId);
      }
      const filepath = join(this.agentsDir, filename);
      await Bun.file(filepath).unlink();
      delete this.agents[agentId];
      this.agentIdToFilename.delete(agentId);
    });
  }

  async listPrompts(): Promise<string[]> {
    const files = await readdir(this.promptDir);
    return files.filter(f => f.endsWith('.md'));
  }
}
