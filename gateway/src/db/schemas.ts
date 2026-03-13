// db/schemas.ts
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import type { LiteLLMMessage, PendingApproval } from '../types'; // Import your types

export const frames = sqliteTable('frames', {
  frameId: text('frame_id').notNull().primaryKey(),
  parentFrameId: text('parent_frame_id'), // Nullable for root frames
  agentId: text('agent_id').notNull(),
  runId: text('run_id').notNull(), // Group frames by execution
  status: text('status').notNull(), // "running" | "suspended" | "completed"
  history: text('history', { mode: 'json' }).$type<LiteLLMMessage[]>().notNull(),
  pendingApprovals: text('pending_approvals', { mode: 'json' }).$type<PendingApproval[]>().notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});
