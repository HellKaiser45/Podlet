import { frames } from './schemas';
import { eq, and } from 'drizzle-orm';
import type { AgentStackFrame } from '../types';
import { createDB } from './db';

export class FrameCRUDClient {
  constructor(private db: ReturnType<typeof createDB>) { }

  /**
   * Create a new frame
   */
  async create(frame: AgentStackFrame, runId: string): Promise<void> {
    await this.db.insert(frames).values({
      frameId: frame.frame_id,
      parentFrameId: frame.parent_frame_id,
      answeringToolCallId: frame.answering_tool_call_id,
      agentId: frame.agent_id,
      runId,
      status: frame.status,
      history: frame.history,
      pendingApprovals: frame.pending_approvals,
    });
  }
  /**
   * Get a single frame by ID
   */
  async getById(frameId: string): Promise<AgentStackFrame | null> {
    const result = await this.db.select().from(frames).where(eq(frames.frameId, frameId));
    return result[0] ? this.toAgentStackFrame(result[0]) : null;
  }

  /**
   * Get all frames for a run (entire execution tree)
   */
  async getByRunId(runId: string): Promise<Record<string, AgentStackFrame>> {
    const results = await this.db.select().from(frames).where(eq(frames.runId, runId));

    return results.reduce((acc, frame) => {
      acc[frame.frameId] = this.toAgentStackFrame(frame);
      return acc;
    }, {} as Record<string, AgentStackFrame>);
  }

  /**
   * Update frame (status, history, approvals)
   */
  async update(frameId: string, updates: Partial<AgentStackFrame>): Promise<void> {
    const updateData: Record<string, any> = { updatedAt: new Date() };

    if (updates.status) updateData.status = updates.status;
    if (updates.history) updateData.history = updates.history;
    if (updates.pending_approvals) updateData.pendingApprovals = updates.pending_approvals;

    await this.db.update(frames).set(updateData).where(eq(frames.frameId, frameId));
  }

  /**
   * Delete a frame
   */
  async delete(frameId: string): Promise<void> {
    await this.db.delete(frames).where(eq(frames.frameId, frameId));
  }

  /**
   * Delete all frames for a run
   */
  async deleteByRunId(runId: string): Promise<void> {
    await this.db.delete(frames).where(eq(frames.runId, runId));
  }

  /**
   * Get frames by status
   */
  async getByStatus(runId: string, status: string): Promise<AgentStackFrame[]> {
    const results = await this.db
      .select()
      .from(frames)
      .where(and(eq(frames.runId, runId), eq(frames.status, status)));

    return results.map(row => this.toAgentStackFrame(row));
  }

  /**
   * Get leaf frames (frames with no children) for a run
   */
  async getLeafFrames(runId: string): Promise<AgentStackFrame[]> {
    const allFrames = await this.db.select().from(frames).where(eq(frames.runId, runId));

    const parentIds = new Set(
      allFrames
        .map(f => f.parentFrameId)
        .filter(id => id !== null)
    );

    return allFrames
      .filter(f => !parentIds.has(f.frameId))
      .map(row => this.toAgentStackFrame(row));
  }

  /**
   * Convert DB row to AgentStackFrame
   */
  private toAgentStackFrame(row: typeof frames.$inferSelect): AgentStackFrame {
    return {
      frame_id: row.frameId,
      parent_frame_id: row.parentFrameId ?? undefined,
      answering_tool_call_id: row.answeringToolCallId ?? undefined,
      agent_id: row.agentId,
      status: row.status as AgentStackFrame["status"],
      history: row.history,
      pending_approvals: row.pendingApprovals,
    };
  }
}
