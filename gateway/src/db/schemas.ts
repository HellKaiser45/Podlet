import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions'
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const agents = sqliteTable('agents', {
  name: text('name').notNull().unique().primaryKey(),
  description: text('description').notNull(),
  systemPrompt: text('system_prompt').notNull(),
  model: text('model').notNull(),
  provider: text('provider').notNull(),
  tools: text('tools', { mode: 'json' }).$type<ChatCompletionTool[]>(),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

export const conversations = sqliteTable('conversations', {
  agentName: text('agent_name').notNull().references(() => agents.name),
  conversationId: text('conversation_id').notNull().unique().primaryKey(),
  history: text('history', { mode: 'json' }).$type<ChatCompletionMessageParam[]>(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});
