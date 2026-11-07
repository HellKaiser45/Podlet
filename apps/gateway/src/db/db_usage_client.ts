import { llm_usage } from './schemas';
import { eq, sql } from 'drizzle-orm';
import type { UsageRecord } from '../llm/usage';
import { createDB } from './db';

/** Every metric for one group of calls. Abbreviated to `calls` for the row count. */
export type TokenSums = {
  input: number;
  output: number;
  total: number;
  cacheRead: number;
  cacheWrite: number;
  noCache: number;
  reasoning: number;
  text: number;
  calls: number;
};

export type UsageTotals = {
  run: TokenSums;
  byFrame: Array<TokenSums & {
    frameId: string;
    parentFrameId: string | null;
    agentId: string;
  }>;
  /** `usage_reported = 1` on at least one row: the provider produced a usage object. */
  reported: boolean;
  /** `usage_requested = 1` on at least one row: we asked the endpoint for one. */
  requested: boolean;
};

function zeroSums(): TokenSums {
  return {
    input: 0,
    output: 0,
    total: 0,
    cacheRead: 0,
    cacheWrite: 0,
    noCache: 0,
    reasoning: 0,
    text: 0,
    calls: 0,
  };
}

/**
 * Aggregates shared by the run total and the per-frame breakdown.
 *
 * `coalesce(sum(col), 0)` because `SUM` over zero rows is NULL, and a NULL
 * column set (an error/incomplete call) must contribute 0, not poison the sum.
 *
 * The flags use `coalesce(sum(case ... end), 0) > 0` for the same reason:
 * `NULL > 0` is NULL, which would surface as a non-boolean.
 */
const SUMS = {
  input: sql<number>`coalesce(sum(${llm_usage.inputTokens}), 0)`,
  output: sql<number>`coalesce(sum(${llm_usage.outputTokens}), 0)`,
  total: sql<number>`coalesce(sum(${llm_usage.totalTokens}), 0)`,
  cacheRead: sql<number>`coalesce(sum(${llm_usage.cacheReadTokens}), 0)`,
  cacheWrite: sql<number>`coalesce(sum(${llm_usage.cacheWriteTokens}), 0)`,
  noCache: sql<number>`coalesce(sum(${llm_usage.noCacheTokens}), 0)`,
  reasoning: sql<number>`coalesce(sum(${llm_usage.reasoningTokens}), 0)`,
  text: sql<number>`coalesce(sum(${llm_usage.textTokens}), 0)`,
  calls: sql<number>`count(*)`,
};

const REPORTED = sql<number>`coalesce(sum(case when ${llm_usage.usageReported} = 1 then 1 else 0 end), 0)`;
const REQUESTED = sql<number>`coalesce(sum(case when ${llm_usage.usageRequested} = 1 then 1 else 0 end), 0)`;

export class UsageCRUDClient {
  constructor(private db: ReturnType<typeof createDB>) { }

  /** One insert per LLM call. A duplicate `call_id` throws (the PK does). */
  async record(rec: UsageRecord): Promise<void> {
    await this.db.insert(llm_usage).values({
      callId: rec.callId,
      runId: rec.runId,
      frameId: rec.frameId,
      parentFrameId: rec.parentFrameId,
      agentId: rec.agentId,
      model: rec.model,
      provider: rec.provider,
      protocol: rec.protocol,
      outcome: rec.outcome,
      finishReason: rec.finishReason,
      usageRequested: rec.usageRequested,
      usageReported: rec.usage.usageReported,
      inputTokens: rec.usage.inputTokens,
      outputTokens: rec.usage.outputTokens,
      totalTokens: rec.usage.totalTokens,
      cacheReadTokens: rec.usage.cacheReadTokens,
      cacheWriteTokens: rec.usage.cacheWriteTokens,
      noCacheTokens: rec.usage.noCacheTokens,
      reasoningTokens: rec.usage.reasoningTokens,
      textTokens: rec.usage.textTokens,
      rawUsage: rec.usage.rawJson,
      rawTruncated: rec.usage.rawTruncated,
    });
  }

  /**
   * Totals for one root run id. Subagents share the run id, so this already
   * includes every nested subagent; `byFrame` keeps them separate.
   *
   * An unknown run returns the zeroed shape with both flags false — never an
   * error, mirroring `GET /history/:runid` which returns `[]`.
   */
  async totals(runId: string): Promise<UsageTotals> {
    const runRows = await this.db
      .select({ ...SUMS, reported: REPORTED, requested: REQUESTED })
      .from(llm_usage)
      .where(eq(llm_usage.runId, runId));

    const frameRows = await this.db
      .select({
        frameId: llm_usage.frameId,
        parentFrameId: llm_usage.parentFrameId,
        agentId: llm_usage.agentId,
        ...SUMS,
      })
      .from(llm_usage)
      .where(eq(llm_usage.runId, runId))
      .groupBy(llm_usage.frameId, llm_usage.agentId, llm_usage.parentFrameId)
      // `min(created_at)`, never a bare `created_at`: inside a GROUP BY a bare
      // column is SQLite's undefined pick, so fan-out order would be arbitrary.
      // `frame_id` is the tiebreak: `min(created_at)` alone only orders by
      // millisecond, so frames sharing one would otherwise tie arbitrarily.
      .orderBy(sql`min(${llm_usage.createdAt}) asc`, llm_usage.frameId);

    const runRow = runRows[0];

    return {
      run: runRow ? pickSums(runRow) : zeroSums(),
      byFrame: frameRows.map((row) => ({
        ...pickSums(row),
        frameId: row.frameId,
        parentFrameId: row.parentFrameId ?? null,
        agentId: row.agentId,
      })),
      reported: runRow ? Number(runRow.reported) > 0 : false,
      requested: runRow ? Number(runRow.requested) > 0 : false,
    };
  }

  /** Usage rows are deleted by RUN only, never by frame. */
  async deleteByRunId(runId: string): Promise<void> {
    await this.db.delete(llm_usage).where(eq(llm_usage.runId, runId));
  }
}

function pickSums(row: Record<string, unknown>): TokenSums {
  const n = (value: unknown): number => Number(value ?? 0);
  return {
    input: n(row.input),
    output: n(row.output),
    total: n(row.total),
    cacheRead: n(row.cacheRead),
    cacheWrite: n(row.cacheWrite),
    noCache: n(row.noCache),
    reasoning: n(row.reasoning),
    text: n(row.text),
    calls: n(row.calls),
  };
}