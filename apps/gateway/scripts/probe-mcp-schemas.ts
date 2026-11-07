/**
 * Probe the MCP servers configured for a Podlet installation and report which
 * tool input schemas contain a JSON Schema keyword our protocols cannot enforce.
 *
 * Run from the repo root:  bun run mcp:probe [--dir <path to podlet dir>]
 *
 * Exit code 1 when any keyword was found (so it can be used as a check), 0 when
 * none was. A server that fails to start is reported and does not stop the rest.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { join, resolve } from 'node:path';
import { prodConfig } from '@podlet/config';
import type { ChatCompletionTool } from '@podlet/types';
import type { MCPConfig } from '../src/types';
import { UNENFORCEABLE_KEYWORDS, findUnenforceableSchemaKeywords } from '../src/llm/schema-compat';

/** A hung server (bad binary, waiting on input) must not block the whole run. */
const SERVER_TIMEOUT_MS = 60_000;

function readDirArgument(argv: string[]): string | undefined {
  const index = argv.indexOf('--dir');
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) {
    console.error('probe: --dir requires a path (e.g. --dir .podlet)');
    process.exit(2);
  }
  return value;
}

function withTimeout<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([work, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

const dir = resolve(readDirArgument(process.argv.slice(2)) ?? prodConfig.podletDir);
const configPath = join(dir, 'mcp.json');

const configFile = Bun.file(configPath);
if (!(await configFile.exists())) {
  console.error(`probe: ${configPath}: no such file`);
  process.exit(2);
}

let servers: Record<string, MCPConfig>;
try {
  const parsed = await configFile.json();
  servers = (parsed?.mcpServers ?? {}) as Record<string, MCPConfig>;
} catch (err) {
  console.error(`probe: ${configPath}: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(2);
}

const keywordNames = UNENFORCEABLE_KEYWORDS.map((entry) => entry.keyword);
const serverIds = Object.keys(servers);

console.log(`probe: ${configPath}`);
console.log(`probe: watching for ${keywordNames.join(', ')}`);

let toolCount = 0;
let toolsWithKeywords = 0;

for (const [id, config] of Object.entries(servers)) {
  console.log(`\n=== ${id}: ${config.command} ${(config.args ?? []).join(' ')}`.trimEnd());
  const client = new Client({ name: 'podlet-mcp-probe', version: '1.0.0' }, { capabilities: {} });

  try {
    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: config.env,
      stderr: 'ignore',
    });
    const { tools } = await withTimeout(
      (async () => {
        await client.connect(transport);
        return client.listTools();
      })(),
      SERVER_TIMEOUT_MS,
      `server '${id}'`,
    );

    toolCount += tools.length;
    console.log(`  tools: ${tools.length}`);

    for (const tool of tools) {
      const definition: ChatCompletionTool = {
        type: 'function',
        function: { name: tool.name, parameters: tool.inputSchema as Record<string, unknown> },
      };
      const occurrences = findUnenforceableSchemaKeywords([definition]);

      if (occurrences.length === 0) {
        console.log(`  - ${tool.name}: none`);
        continue;
      }

      toolsWithKeywords += 1;
      console.log(
        `  - ${tool.name}: ${occurrences.map((o) => `${o.keyword} at ${o.path}`).join('; ')}`,
      );
      const rendered = JSON.stringify(tool.inputSchema, null, 2)
        .split('\n')
        .map((line) => `    ${line}`)
        .join('\n');
      console.log('    inputSchema:');
      console.log(rendered);
    }
  } catch (err) {
    console.error(`  FAILED: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await client.close().catch(() => {});
  }
}

console.log(
  `\n${serverIds.length} servers, ${toolCount} tools, ${toolsWithKeywords} with unenforceable keywords`,
);

process.exit(toolsWithKeywords > 0 ? 1 : 0);