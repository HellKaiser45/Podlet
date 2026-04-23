import { readdir } from "node:fs/promises";
import { join } from 'node:path'
import { Agent } from "../types"


export default class AgentsManager {
  private readonly agentsDir: string;
  private readonly promptDir: string;
  agents: Record<string, Agent> = {}

  constructor(basedir: string) {
    this.agentsDir = join(basedir, 'agents');
    this.promptDir = join(basedir, 'prompts');
  }

  async loadAll() {
    const filePaths = await readdir(this.agentsDir);

    const agentPromises = filePaths
      .filter(f => f.endsWith('.json'))
      .map(filePath => import(join(this.agentsDir, filePath)));

    const results = await Promise.all(agentPromises);

    const agents = results.map(({ default: agent }) => agent) as Agent[];

    for (const agent of agents) {
      this.agents[agent.agentId] = agent
    }
  }

  async getAgentprompt(agentId: string) {
    const path = this.agents[agentId].system_prompt


    const { default: prompt } = await import(join(this.promptDir, path), { with: { type: "text" } })

    return prompt
  }
}

