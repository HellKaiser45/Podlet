import type { ChatCompletionTool } from '@podlet/types';
import type { Protocol } from '../types';

/**
 * A JSON Schema keyword that one of our protocols cannot enforce, and on which
 * protocols that is true.
 *
 * Reporting only: nothing here rewrites a schema. The list exists so a
 * diagnostic can name the offending TOOL instead of leaving the user with a
 * provider warning that only names the model.
 */
type UnenforceableKeyword = {
  keyword: string;
  protocols: Protocol[];
};

export const UNENFORCEABLE_KEYWORDS: UnenforceableKeyword[] = [
  {
    // `propertyNames` constrains the KEYS of an object. On the openai protocol
    // it is unenforceable both ways round: @ai-sdk/openai deletes it before the
    // request leaves the process (normalize-openai-json-schema.ts in
    // @ai-sdk/openai), and @ai-sdk/openai-compatible does not normalize at all,
    // so it forwards the keyword to an endpoint that may reject it outright.
    // Both factories are the `openai` protocol: `system/providers.ts` maps a
    // provider to its protocol, and `llm/provide.ts` splits canonical openai
    // from openai-compatible by provider name. anthropic and google accept
    // plain JSON Schema, so the keyword is enforceable there.
    keyword: 'propertyNames',
    protocols: ['openai'],
  },
];

/** One occurrence of an unenforceable keyword, attributed to the tool carrying it. */
type SchemaOccurrence = {
  toolName: string;
  keyword: string;
  /** JSON path inside the tool's `parameters`, e.g. `properties.env.propertyNames`. */
  path: string;
};

/** The keywords this protocol cannot enforce. Empty means "report nothing". */
export function keywordsUnenforceableOn(protocol: Protocol): UnenforceableKeyword[] {
  return UNENFORCEABLE_KEYWORDS.filter((entry) => entry.protocols.includes(protocol));
}

/** Schema positions holding a single schema. */
const SINGLE_SCHEMA_KEYS = [
  'items',
  'additionalProperties',
  'additionalItems',
  'not',
  'if',
  'then',
  'else',
] as const;

/** Schema positions holding a list of schemas. */
const SCHEMA_LIST_KEYS = ['anyOf', 'oneOf', 'allOf'] as const;

/** Schema positions holding a map of name -> schema. */
const SCHEMA_MAP_KEYS = ['properties', 'patternProperties', '$defs', 'definitions'] as const;

/**
 * Every `{ toolName, keyword, path }` occurrence of an unenforceable keyword in
 * the request's tool definitions. Pure: no logging, no I/O, never mutates the
 * tools, never throws (cycles are cut with `visited`, non-object nodes are
 * ignored).
 */
export function findUnenforceableSchemaKeywords(
  tools: ChatCompletionTool[] | undefined,
): SchemaOccurrence[] {
  if (!Array.isArray(tools)) return [];

  const occurrences: SchemaOccurrence[] = [];
  const keywords = UNENFORCEABLE_KEYWORDS.map((entry) => entry.keyword);

  for (const tool of tools) {
    const fn = (tool as { function?: { name?: unknown; parameters?: unknown } } | null)?.function;
    const toolName = typeof fn?.name === 'string' ? fn.name : '<unnamed>';
    walkSchema(fn?.parameters, toolName, '', keywords, occurrences);
  }

  return occurrences;
}

function walkSchema(
  node: unknown,
  toolName: string,
  path: string,
  keywords: string[],
  occurrences: SchemaOccurrence[],
  visited: Set<object> = new Set(),
): void {
  if (Array.isArray(node)) {
    node.forEach((child, index) => walkSchema(child, toolName, `${path}[${index}]`, keywords, occurrences, visited));
    return;
  }
  if (!isSchemaObject(node)) return;
  if (visited.has(node)) return;
  visited.add(node);

  for (const keyword of keywords) {
    if (!Object.prototype.hasOwnProperty.call(node, keyword)) continue;
    if (node[keyword] === undefined) continue;
    occurrences.push({ toolName, keyword, path: joinPath(path, keyword) });
  }

  for (const key of SCHEMA_MAP_KEYS) {
    const map = node[key];
    if (!isSchemaObject(map)) continue;
    for (const [name, child] of Object.entries(map)) {
      walkSchema(child, toolName, joinPath(path, joinPath(key, name)), keywords, occurrences, visited);
    }
  }

  for (const key of SINGLE_SCHEMA_KEYS) {
    // Also covers the legacy tuple form of `items`, which is an array.
    walkSchema(node[key], toolName, joinPath(path, key), keywords, occurrences, visited);
  }

  for (const key of SCHEMA_LIST_KEYS) {
    const list = node[key];
    if (!Array.isArray(list)) continue;
    walkSchema(list, toolName, joinPath(path, key), keywords, occurrences, visited);
  }
}

function isSchemaObject(node: unknown): node is Record<string, unknown> {
  return typeof node === 'object' && node !== null && !Array.isArray(node);
}

function joinPath(path: string, key: string): string {
  return path ? `${path}.${key}` : key;
}