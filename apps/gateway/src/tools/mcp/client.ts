import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type {
  ChatCompletionTool,
} from 'openai/resources/chat/completions';
import { LiteLLMMessage, MCPConfig, MCPInstance } from "../../types";
import { join } from "path";
import { SerialQueue } from "../../utils/serial-queue";


export default class MCPManager {
  private filepath: string;
  mcps: Record<string, MCPConfig> = {};
  runningInstances: Record<string, MCPInstance> = {};
  private serialQueue = new SerialQueue();
  private starting: Set<string> = new Set();

  constructor(path: string) {
    this.filepath = join(path, 'mcp.json');
  }

  async init() {
    const { default: allmymcps } = await import(this.filepath)
    this.mcps = allmymcps.mcpServers
  }

  async startserver(mcpId: string) {
    const mcp = this.mcps[mcpId]
    if (this.runningInstances[mcpId]) return

    while (this.starting.has(mcpId)) {
      await new Promise(r => setTimeout(r, 100));
    }
    if (this.runningInstances[mcpId]) return;

    this.starting.add(mcpId);
    try {
      const transport = new StdioClientTransport({
        command: mcp.command,
        args: mcp.args,
        env: mcp.env,
      });

      const client = new Client(
        { name: "mcp-gateway", version: "1.0.0" },
        { capabilities: {} }
      );

      await client.connect(transport);

      const toolsResult = await client.listTools()

      const tools: ChatCompletionTool[] = toolsResult.tools.map((tool) => ({
        type: "function",
        function: {
          name: `${mcpId}_${tool.name}`,
          description: tool.description,
          parameters: tool.inputSchema,
        },
      }));

      this.runningInstances[mcpId] = { client, tools }
    } finally {
      this.starting.delete(mcpId);
    }
  }

  async create(mcpsIds: string[]) {
    const servertostart = []
    for (const mcpId of mcpsIds) {
      servertostart.push(this.startserver(mcpId))
    }
    await Promise.all(servertostart)
  }

  async call(toolname: string, toolCallId: string, args: Record<string, unknown>): Promise<LiteLLMMessage> {
    let mcpId: string | null = null;
    let actualToolName: string | null = null;
    for (const [id, instance] of Object.entries(this.runningInstances)) {
      const found = instance.tools.find(t => t.type === 'function' && t.function.name === toolname);
      if (found) {
        mcpId = id;
        actualToolName = found.function.name.slice(id.length + 1);
        break;
      }
    }
    if (!mcpId || actualToolName === null) {
      throw new Error(`No running MCP instance found for tool: ${toolname}`);
    }
    const result = await this.runningInstances[mcpId].client.callTool({ name: actualToolName, arguments: args })
    return {
      role: "tool",
      tool_call_id: toolCallId,
      content: JSON.stringify(result.content)
    }
  }

  async stop(mcpid: string) {
    if (!this.runningInstances[mcpid]) return;

    await this.runningInstances[mcpid].client.close();
    delete this.runningInstances[mcpid];
  }

  async stopAll() {
    await Promise.all(
      Object.values(this.runningInstances).map(i => i.client.close())
    );
    this.runningInstances = {};
  }

  getTools(mcpids: string[]): ChatCompletionTool[] {
    const tools: ChatCompletionTool[] = []
    for (const mcpid of mcpids) {
      tools.push(...this.runningInstances[mcpid].tools)
    }
    return tools
  }

  isRunning(toolName: string): boolean {
    for (const instance of Object.values(this.runningInstances)) {
      if (instance.tools.some(t => t.type === 'function' && t.function.name === toolName)) {
        return true;
      }
    }
    return false;
  }

  async createConfig(name: string, config: MCPConfig): Promise<MCPConfig> {
    return this.serialQueue.enqueue(async () => {
      if (this.mcps[name]) {
        throw new Error('MCP already exists: ' + name);
      }
      this.mcps[name] = config;
      await this.save();
      return config;
    });
  }

  async updateConfig(name: string, partial: Partial<MCPConfig>): Promise<MCPConfig> {
    return this.serialQueue.enqueue(async () => {
      if (!this.mcps[name]) {
        throw new Error('MCP not found: ' + name);
      }
      this.mcps[name] = { ...this.mcps[name], ...partial };
      await this.save();
      return this.mcps[name];
    });
  }

  async deleteConfig(name: string): Promise<void> {
    return this.serialQueue.enqueue(async () => {
      if (!this.mcps[name]) {
        throw new Error('MCP not found: ' + name);
      }
      await this.stop(name);
      delete this.mcps[name];
      await this.save();
    });
  }

  private async save(): Promise<void> {
    await Bun.file(this.filepath).write(JSON.stringify({ mcpServers: this.mcps }, null, 2));
  }
}
