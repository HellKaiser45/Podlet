import { run_history } from './schemas';
import { eq } from 'drizzle-orm';
import type { LiteLLMMessage } from '../types';
import { createDB } from './db';

export class HistoryCRUDClient {
  constructor(private db: ReturnType<typeof createDB>) { }

  /**
   * Create a new history entry for a run
   */
  async create(runId: string, initialHistory: LiteLLMMessage[] = []): Promise<void> {
    await this.db.insert(run_history).values({
      runId,
      history: initialHistory,
    });
  }

  /**
   * Get history for a run
   */
  async getByRunId(runId: string): Promise<LiteLLMMessage[]> {
    const result = await this.db
      .select({ history: run_history.history })
      .from(run_history)
      .where(eq(run_history.runId, runId));

    return result[0]?.history;
  }

  /**
   * Get full row (useful if you add more columns later)
   */
  async getFullByRunId(runId: string): Promise<typeof run_history.$inferSelect | null> {
    const result = await this.db
      .select()
      .from(run_history)
      .where(eq(run_history.runId, runId));

    return result[0] ?? null;
  }

  /**
    * Append messages to the history (most common operation)
    * Returns the new history array after append
    */
  async append(runId: string, newMessages: LiteLLMMessage | LiteLLMMessage[]): Promise<LiteLLMMessage[]> {
    const messagesToAdd = Array.isArray(newMessages) ? newMessages : [newMessages];

    // Load current history
    const current = await this.getByRunId(runId);
    if (!current) {
      throw new Error(`No history found for runId: ${runId}`);
    }

    const updatedHistory = [...current, ...messagesToAdd];

    await this.db
      .update(run_history)
      .set({
        history: updatedHistory,
      })
      .where(eq(run_history.runId, runId));

    return updatedHistory;
  }

  /**
   * Replace the entire history (use this for compression / in-place updates)
   */
  async update(runId: string, newHistory: LiteLLMMessage[]): Promise<void> {
    await this.db
      .update(run_history)
      .set({
        history: newHistory,
      })
      .where(eq(run_history.runId, runId));
  }

  /**
   * Delete history for a run
   */
  async deleteByRunId(runId: string): Promise<void> {
    await this.db.delete(run_history).where(eq(run_history.runId, runId));
  }

  /**
   * Check if a run has history
   */
  async exists(runId: string): Promise<boolean> {
    const result = await this.db
      .select({ runId: run_history.runId })
      .from(run_history)
      .where(eq(run_history.runId, runId))
      .limit(1);

    return result.length > 0;
  }

  /**
   * Optional: Get token count estimate (if you store it separately later)
   * For now, you can compute it in your service layer using your countTokens function
   */
}
