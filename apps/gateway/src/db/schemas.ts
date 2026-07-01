import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
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


