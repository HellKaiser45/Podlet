
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type {
  ChatCompletionTool,
} from 'openai/resources/chat/completions';
import { LiteLLMMessage, MCPConfig, MCPInstance } from "../../types";
import { join } from "path";


export default class MCPManager {
  private filepath: string;
  mcps: Record<string, MCPConfig> = {};
  runningInstances: Record<string, MCPInstance> = {};

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
  }

  async create(mcpsIds: string[]) {
    const servertostart = []
    for (const mcpId of mcpsIds) {
      servertostart.push(this.startserver(mcpId))
    }
    Promise.all(servertostart)
  }

  async call(toolname: string, toolCallId: string, args: Record<string, unknown>): Promise<LiteLLMMessage> {
    const [first, ...rest] = toolname.split("_")
    const second = rest.join("_")
    const result = await this.runningInstances[first].client.callTool({ name: second, arguments: args })
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
}
