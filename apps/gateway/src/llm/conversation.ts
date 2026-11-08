import { createHash } from 'node:crypto';
import type { LiteLLMMessage } from '../types';

/**
 * Stable-JSON serialization with recursively sorted object keys.
 *
 * `JSON.stringify` emits keys in insertion order, so two structures that differ
 * only in key order would hash differently. The Python implementation this
 * reproduces used `json.dumps(..., sort_keys=True)`, which sorts at every level.
 *
 * Non-JSON values are stringified the way Python's `default=str` would: the
 * value is coerced rather than dropped, so the hash stays total.
 */
function stableStringify(value: unknown): string {
  return stringifySorted(value, new Set());
}

function stringifySorted(value: unknown, seen: Set<unknown>): string {
  if (value === null) return 'null';

  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'number':
      return Number.isFinite(value) ? JSON.stringify(value) : JSON.stringify(String(value));
    case 'boolean':
      return value ? 'true' : 'false';
    case 'undefined':
      return 'null';
    case 'bigint':
      return JSON.stringify(value.toString());
    default:
      break;
  }

  if (typeof value !== 'object') {
    // function / symbol: Python's `default=str` equivalent.
    return JSON.stringify(String(value));
  }

  // A cyclic structure has no JSON form; Python's json.dumps would raise, so
  // fall back to the plain coerced string instead of looping forever.
  if (seen.has(value)) return JSON.stringify('[circular]');
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value.map((entry) => stringifySorted(entry, seen)).join(',')}]`;
    }
    const object = value as Record<string, unknown>;
    const keys = Object.keys(object).sort();
    const entries = keys.map(
      (key) => `${JSON.stringify(key)}:${stringifySorted(object[key], seen)}`,
    );
    return `{${entries.join(',')}}`;
  } finally {
    seen.delete(value);
  }
}

/**
 * Conversation id, reproduced from the deleted Python service
 * (`agent_core_py/core.py::_compute_conversation_id`) so the `x-opencode-session`
 * header keeps the exact value it used to carry:
 *
 *  - first message whose role is not 'system';
 *  - no such message -> the literal string "default";
 *  - string content -> hashed as raw UTF-8;
 *  - array content -> hashed as key-sorted JSON (Python: json.dumps sort_keys);
 *  - sha256 hex, first 32 characters.
 */
export function computeConversationId(history: LiteLLMMessage[]): string {
  const firstNonSystem = history.find((message) => message?.role !== 'system');
  if (firstNonSystem === undefined) return 'default';

  const content: unknown = (firstNonSystem as { content?: unknown }).content;
  if (Array.isArray(content)) {
    return sha256Hex32(stableStringify(content));
  }
  // A non-string, non-array content (null is the common one: an assistant turn
  // that only carried tool calls) hashes as Python hashed `str(content)`.
  return sha256Hex32(typeof content === 'string' ? content : String(content ?? ''));
}

function sha256Hex32(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 32);
}

/** The `x-opencode-session` value: `ses_` plus the derived conversation id. */
function opencodeSessionId(conversationId: string): string {
  return `ses_${conversationId}`;
}

/**
 * Per-request headers for a provider. `opencode_session` is dynamic (it depends
 * on the conversation, not the model entry), so it cannot live in the static
 * provider table and is merged in here.
 */
export function conversationHeaders(
  conversationId: string,
  quirks: { opencode_session?: boolean } | undefined,
): Record<string, string> {
  if (quirks?.opencode_session !== true) return {};
  return { 'x-opencode-session': opencodeSessionId(conversationId) };
}