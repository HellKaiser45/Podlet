import { Glob } from "bun";
import { join } from 'node:path'
import type { Agent } from "./types"

export class AgentCRUDClient {
  private readonly promptDir: string;
  private readonly agentsDir: string;

  constructor(promptDir: string = '.podlet/prompts/', agentsDir: string = '.podlet/agents/') {
    const home = Bun.env.HOME || Bun.env.USERPROFILE || ".";
    this.promptDir = join(home, promptDir);
    this.agentsDir = join(home, agentsDir);
  }

  async loadAll(): Promise<Agent[]> {
    const glob = new Glob('*.json');
    const filePaths = await Array.fromAsync(glob.scan({
      cwd: this.agentsDir,
      absolute: true,
    }));

    return await Promise.all(
      filePaths.map(filepath => this.loadAgentFromPath(filepath))
    );
  }

  async loadAgent(name: string): Promise<Agent> {
    const cleanName = name.endsWith('.json') ? name : `${name}.json`;
    const filePath = join(this.agentsDir, cleanName);

    const file = Bun.file(filePath);
    if (!(await file.exists())) {
      throw new Error(`Agent "${name}" not found at: ${filePath}`);
    }

    return this.loadAgentFromPath(filePath);
  }

  private async loadAgentFromPath(filePath: string): Promise<Agent> {
    const agentData: Agent = await Bun.file(filePath).json();

    const systemPrompt = await Bun.file(
      join(this.promptDir, agentData.system_prompt)
    ).text();

    return {
      ...agentData,
      system_prompt: systemPrompt,
    };
  }
}
