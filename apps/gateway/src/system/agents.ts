import { readdir } from "node:fs/promises";
import { join, resolve, sep } from 'node:path'
import { Agent } from "../types"
import { SerialQueue } from "../utils/serial-queue"


export default class AgentsManager {
  private readonly agentsDir: string;
  private readonly promptDir: string;
  agents: Record<string, Agent> = {}
  private agentIdToFilename: Map<string, string> = new Map();
  private serialQueue = new SerialQueue();

  constructor(basedir: string) {
    this.agentsDir = join(basedir, 'agents');
    this.promptDir = join(basedir, 'prompts');
  }


  async loadAll() {
    this.agents = {};
    this.agentIdToFilename.clear();

    const allFiles = await readdir(this.agentsDir);
    const filePaths = allFiles.filter(f => f.endsWith('.json'));

    const results = await Promise.all(
      filePaths.map(async filePath => {
        try {
          // Bun caches import()ed modules by path, so in-place rewrites (the
          // rename cascade) would stay invisible to this reload
          return (await Bun.file(join(this.agentsDir, filePath)).json()) as Agent;
        } catch (e) {
          console.warn(`[AgentsManager] skipping unreadable agent file: ${filePath}`, e);
          return null;
        }
      })
    );

    for (let i = 0; i < results.length; i++) {
      const agent = results[i];
      if (!agent) continue;
      if (typeof agent.agentId !== 'string' || !/^[a-zA-Z0-9_-]{1,58}$/.test(agent.agentId)) {
        console.warn(`[AgentsManager] skipping agent file with invalid agent id: ${filePaths[i]}`);
        continue;
      }
      this.agents[agent.agentId] = agent;
      this.agentIdToFilename.set(agent.agentId, filePaths[i]);
    }
  }

  async reload() {
    return this.serialQueue.enqueue(() => this.loadAll());
  }

  async getAgentprompt(agentId: string) {
    const promptFile = this.agents[agentId].system_prompt;
    const resolvedPath = resolve(this.promptDir, promptFile);
    const normalizedPromptDir = resolve(this.promptDir) + sep;

    if (!resolvedPath.startsWith(normalizedPromptDir)) {
      throw new Error(`Invalid prompt path: path traversal detected`);
    }

    const { default: prompt } = await import(resolvedPath, { with: { type: "text" } })

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
    return this.serialQueue.enqueue(async () => {
      if (!/^[a-zA-Z0-9_-]{1,58}$/.test(agent.agentId)) {
        throw new Error('Invalid agent id: use letters, digits, - or _ (max 58)');
      }
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
    return this.serialQueue.enqueue(async () => {
      const existing = this.agents[agentId];
      if (!existing) {
        throw new Error('Agent not found: ' + agentId);
      }
      const filename = this.agentIdToFilename.get(agentId);
      if (!filename) {
        throw new Error('Agent file not found: ' + agentId);
      }
      const { agentId: requestedAgentId, ...safePartial } = partial;
      const newAgentId = requestedAgentId?.trim();

      if (newAgentId && newAgentId !== agentId) {
        if (!/^[a-zA-Z0-9_-]{1,58}$/.test(newAgentId)) {
          throw new Error('Invalid agent id: use letters, digits, - or _ (max 58)');
        }
        if (this.agents[newAgentId]) {
          throw new Error('Agent already exists: ' + newAgentId);
        }

        const renamed: Agent = { ...existing, ...safePartial, agentId: newAgentId };
        const newFilename = this.toFilename(newAgentId);
        for (const [otherId, otherFilename] of this.agentIdToFilename) {
          if (otherId !== agentId && otherFilename === newFilename) {
            throw new Error('Filename collision: ' + newFilename);
          }
        }
        await Bun.file(join(this.agentsDir, newFilename)).write(JSON.stringify(renamed, null, 2));
        // only unlink when the filename actually changed: a slug+hash collision
        // between old and new id would otherwise delete the file we just wrote
        if (newFilename !== filename) {
          try {
            await Bun.file(join(this.agentsDir, filename)).unlink();
          } catch (e) {
            console.error(`[AgentsManager] failed to unlink old agent file: ${filename}`, e);
          }
        }

        delete this.agents[agentId];
        this.agents[newAgentId] = renamed;
        this.agentIdToFilename.delete(agentId);
        this.agentIdToFilename.set(newAgentId, newFilename);

        for (const [otherId, otherAgent] of Object.entries(this.agents)) {
          if (otherId === newAgentId) continue;
          const subAgents = otherAgent.subAgents;
          if (subAgents?.includes(agentId)) {
            const cascaded: Agent = {
              ...otherAgent,
              subAgents: subAgents.map((id) => (id === agentId ? newAgentId : id)),
            };
            this.agents[otherId] = cascaded;
            const otherFilename = this.agentIdToFilename.get(otherId);
            if (otherFilename) {
              try {
                await Bun.file(join(this.agentsDir, otherFilename)).write(JSON.stringify(cascaded, null, 2));
              } catch (e) {
                console.warn(`[AgentsManager] cascade write failed for agent: ${otherId}`, e);
              }
            }
          }
        }

        return renamed;
      }

      const updated = { ...existing, ...safePartial };
      const filepath = join(this.agentsDir, filename);
      await Bun.file(filepath).write(JSON.stringify(updated, null, 2));
      this.agents[agentId] = updated;
      return updated;
    });
  }

  async delete(agentId: string): Promise<void> {
    return this.serialQueue.enqueue(async () => {
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
