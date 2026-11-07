import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import type { LiteLLMMessage, PendingApproval } from '../types';

export const frames = sqliteTable('frames', {
  frameId: text('frame_id').notNull().primaryKey(),
  parentFrameId: text('parent_frame_id'),
  answeringToolCallId: text('answering_tool_call_id'),
  agentId: text('agent_id').notNull(),
  runId: text('run_id').notNull(),
  status: text('status').notNull(),
  history: text('history', { mode: 'json' }).$type<LiteLLMMessage[]>().notNull(),
  pendingApprovals: text('pending_approvals', { mode: 'json' }).$type<PendingApproval[]>().notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

export const run_history = sqliteTable('run_history', {
  runId: text('run_id').notNull().primaryKey(),
  history: text('history', { mode: 'json' }).$type<LiteLLMMessage[]>().notNull(),
  preview: text('preview'),
  label: text('label'),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

/**
 * One row per LLM call, attributed to the ROOT run id. Subagents inherit the
 * parent's `runId`, so `SUM(...) WHERE run_id = ?` already covers every nested
 * subagent; per-instance attribution is `frame_id` + `parent_frame_id`.
 *
 * `timestamp_ms` (not `timestamp`): the second-granularity mapper makes the
 * ordering of a fan-out undefined.
 *
 * `raw_usage` is plain `text` because it may be truncated (a stringified JSON
 * object, or the `{__truncated:true}` marker) — never `mode: 'json'`.
 */
export const llm_usage = sqliteTable('llm_usage', {
  callId: text('call_id').notNull().primaryKey(),
  runId: text('run_id').notNull(),
  frameId: text('frame_id').notNull(),
  parentFrameId: text('parent_frame_id'),
  agentId: text('agent_id').notNull(),
  /** models.json key, e.g. "fast". */
  model: text('model').notNull(),
  /** e.g. "openrouter". */
  provider: text('provider').notNull(),
  protocol: text('protocol').notNull(),
  /** 'finish' | 'error' | 'incomplete'. */
  outcome: text('outcome').notNull(),
  /** Mapped as the terminal chunk's finish_reason, or 'error' / 'incomplete'. */
  finishReason: text('finish_reason').notNull(),
  usageRequested: integer('usage_requested', { mode: 'boolean' }).notNull(),
  usageReported: integer('usage_reported', { mode: 'boolean' }).notNull(),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  totalTokens: integer('total_tokens'),
  cacheReadTokens: integer('cache_read_tokens'),
  cacheWriteTokens: integer('cache_write_tokens'),
  noCacheTokens: integer('no_cache_tokens'),
  reasoningTokens: integer('reasoning_tokens'),
  textTokens: integer('text_tokens'),
  rawUsage: text('raw_usage'),
  rawTruncated: integer('raw_truncated', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).$defaultFn(() => new Date()),
}, (t) => [
  index('llm_usage_run').on(t.runId),
  index('llm_usage_run_frame').on(t.runId, t.frameId),
]);