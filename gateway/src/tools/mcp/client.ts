import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import type {
  ChatCompletionTool,
  ChatCompletionMessageParam,
} from 'openai/resources/chat/completions';


interface MCPConfig {
  id: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}

interface MCPInstance {
  id: string;
  client: Client;
  tools: ChatCompletionTool[]
}

async function getMCPConfigs(path?: string): Promise<MCPConfig[]> {
  const home = Bun.env.HOME || Bun.env.USERPROFILE || ".";
  //WARN: Here the path is hardcoded and maybe it will change in the future
  const resolvedPath = path ?? `${home}/.podlet/mcp.json`;

  const file = Bun.file(resolvedPath);

  if (!(await file.exists())) {
    console.error(`Config file not found at: ${resolvedPath}`);
    return [];
  }

  try {
    const data = await file.json();
    const servers = data.mcpServers;

    if (!servers || typeof servers !== 'object') return [];

    return Object.entries(servers).map(([id, config]: [string, any]) => ({
      id,
      ...config
    }));
  } catch (e) {
    console.error("Failed to parse MCP config JSON:", e);
    return [];
  }
}

export class MCPManager {
  private MCPids: string[] = [];
  private instances = new Map<string, MCPInstance>();

  constructor(mcpids: string[] = []) {
    this.MCPids = mcpids;
  }

  private async start(id: string, config: MCPConfig): Promise<void> {
    if (this.instances.has(id)) return;

    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: config.env,
    })

    const client = new Client(
      { name: "mcp-gateway", version: "1.0.0" },
      { capabilities: {} }
    );

    await client.connect(transport);

    const toolsResult = await client.listTools()

    const tools: ChatCompletionTool[] = toolsResult.tools.map((tool) => ({
      type: "function" as const,
      function: {
        name: `${id}_${tool.name}`,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    }));

    this.instances.set(id, { id, client, tools });

  }

  async call(toolName: string, args: any): Promise<string> {
    for (const instance of this.instances.values()) {
      const tool = instance.tools.find((t) =>
        'function' in t && t.function.name === toolName
      );
      if (tool && 'function' in tool) {
        const originalName = toolName.replace(`${instance.id}_`, "");

        const result = await instance.client.request(
          {
            method: "tools/call",
            params: { name: originalName, arguments: args },
          },
          CallToolResultSchema
        );

        return result.content
          .map((block: any) => block.type === "text" ? block.text : JSON.stringify(block))
          .join("\n");
      }
    }
    throw new Error(`Tool not found: ${toolName}`);
  }
  async stop(id: string): Promise<void> {
    const instance = this.instances.get(id);
    if (!instance) return;

    await instance.client.close();
    this.instances.delete(id);
  }

  async stopAll(): Promise<void> {
    await Promise.all(
      Array.from(this.instances.keys()).map((id) => this.stop(id))
    );
  }

  getTools(): ChatCompletionTool[] {
    return Array.from(this.instances.values()).flatMap((i) => i.tools);
  }

  isRunning(id: string): boolean {
    return this.instances.has(id);
  }

  getRunningIds(): string[] {
    return Array.from(this.instances.keys());
  }

  buildToolResultMessage(
    toolCallId: string,
    content: string
  ): ChatCompletionMessageParam {
    return {
      role: "tool",
      tool_call_id: toolCallId,
      content: typeof content === "string" ? content : JSON.stringify(content),
    };
  }
}

/**
 * Factory function to initialize an MCPManager with specific servers
 * based on their IDs from the config file.
 */
export async function createManagerWithMCPs(requestedIds: string | string[]): Promise<MCPManager> {
  const ids = Array.isArray(requestedIds) ? requestedIds : [requestedIds];
  const allConfigs = await getMCPConfigs();
  const manager = new MCPManager();

  const targetConfigs = allConfigs.filter((config) => ids.includes(config.id));

  if (targetConfigs.length === 0) {
    console.warn(`[MCP] No matching configurations found for: ${ids.join(", ")}`);
    return manager;
  }

  for (const config of targetConfigs) {
    try {
      console.log(`[MCP] Starting server: ${config.id}...`);
      await manager.start(config.id, config);
    } catch (error) {
      console.error(`[MCP] Failed to start ${config.id}:`, error);
    }
  }

  return manager;
}
