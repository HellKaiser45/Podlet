import { EventType } from "@ag-ui/core";
import { AgentChatLoop } from "./agent-loop/chat-loop";
import AppContainer from "./runtime";
import { AgentStackFrame, RunAgentInput, UserDecision, ExecutionContext, AgentState, LiteLLMMessage, DEFAULT_MAX_ITERATIONS } from "./types";
import { randomUUIDv7 } from "bun";
import { VirtualFileSystem } from "./system/sandbox";


/**
 * Reasoning keys that must never leave the in-loop frame history.
 * H1/H4: the loop (and the suspension checkpoint) keeps them; persistence and
 * the RUN_FINISHED payload do not.
 */
const REASONING_KEYS = ["reasoning_content", "thinking_blocks"] as const;

/**
 * Returns a copy of `message` with `reasoning_content` / `thinking_blocks`
 * removed. Never mutates its argument: the frame history the loop still reads
 * is left untouched.
 */
export function stripReasoning(message: LiteLLMMessage): LiteLLMMessage {
  const copy: Record<string, unknown> = { ...(message as unknown as Record<string, unknown>) };
  for (const key of REASONING_KEYS) {
    delete copy[key];
  }
  return copy as unknown as LiteLLMMessage;
}

/**
 * H3/H6 projection: `role==='user' || (role==='assistant' && no tool_calls)`,
 * order-preserving, with reasoning stripped from the surviving assistant
 * messages and nothing else touched. Applied to the run_history row and to the
 * `RUN_FINISHED` payload; never to `frames.history` (H4).
 */
export function projectHistoryForPersistence(history: LiteLLMMessage[]): LiteLLMMessage[] {
  return history
    .filter(m => {
      if (m.role === 'user') return true
      if (m.role === 'assistant' && !('tool_calls' in m && (m as any).tool_calls?.length)) return true
      return false
    })
    .map(m => (m.role === 'assistant' ? stripReasoning(m) : m));
}


function detectnewleaf(input: AgentStackFrame): boolean {
  if ((!input.pending_approvals || input.pending_approvals.length === 0) && input.status === "suspended") {
    return true
  }
  else if (input.pending_approvals && input.pending_approvals.length > 0 && input.pending_approvals.some(pa => pa.approval_status.approval === "pending")) {
    return true
  }
  else if (input.status === "completed") {
    return false
  }
  else {
    throw new Error(`Unexpected state: ${input.status}`)
  }
}

export class AgentOrchestrator {
  private appContainer: AppContainer
  constructor(container: AppContainer) {
    this.appContainer = container
  }

  async initFrame(agent: string, message: LiteLLMMessage, runId?: string): Promise<AgentStackFrame> {
    let agentHistory: LiteLLMMessage[] = []
    if (runId) {
      const history = await this.appContainer.historyManager.exists(runId)

      if (history) {
        agentHistory = await this.appContainer.historyManager.getByRunId(runId)
      }
      else {
        await this.appContainer.historyManager.create(runId, [message])
      }
    }
    agentHistory.push(message)
    return {
      frame_id: randomUUIDv7(),
      agent_id: agent,
      history: agentHistory,
      pending_approvals: [],
      status: "running",
    }
  }

  async EndingEventHandler(input: RunAgentInput, res: AgentStackFrame) {
    const conversationHistory = projectHistoryForPersistence(res.history)
    if (res.status === 'error' || res.status === 'running') {
      console.error(`[Orchestrator] Run ${input.runId} ended with status: ${res.status}`);
      // The loop already emitted a descriptive RUN_ERROR for 'error' status
      // Only emit our own for unexpected 'running' status
      if (res.status === 'running') {
        this.appContainer.eventManager[input.runId].push({
          AgentId: input.agentId,
          type: EventType.RUN_ERROR,
          message: `Agent ended unexpectedly with status: running. This indicates a bug in the agent loop.`,
          threadId: input.threadId,
          runId: input.runId,
        })
      }
    }
    else {
      this.appContainer.eventManager[input.runId].push({
        AgentId: input.agentId,
        type: EventType.RUN_FINISHED,
        threadId: input.threadId,
        runId: input.runId,
        // H6: shallow copy so the live frame object is never handed to the
        // browser with its in-loop reasoning still attached.
        result: { ...res, history: conversationHistory },
      })
      await this.appContainer.historyManager.update(input.runId, conversationHistory)
    }
  }
  /** Main entry point to sort and route depending if we are resuming or not */
  async executeAgent(input: RunAgentInput) {

    this.appContainer.eventManager[input.runId].push({
      AgentId: input.agentId,
      type: EventType.RUN_STARTED,
      threadId: input.threadId,
      runId: input.runId,
    })

    const existing_checkpoint = await this.appContainer.frameCRUD.getByRunId(input.runId)

    let output_frame: AgentStackFrame

    if (Object.keys(existing_checkpoint).length !== 0) {
      output_frame = await this.resume(input)
    } else {
      output_frame = await this.startNewExecution(input)
    }
    await this.EndingEventHandler(input, output_frame)
    return output_frame
  }

  /** Start a new execution for the agent */
  private async startNewExecution(input: RunAgentInput) {
    if (!input.message) { throw new Error('We are trying to start a new execution but a message is missing from the input') }
    const start = new VirtualFileSystem(this.appContainer.initConfig.podletDir, input.runId)
    const blocks = await start.generateContentBlock(input.attachmentIds ?? [], input.message)

    const frame = await this.initFrame(input.agentId, blocks, input.runId)
    const context: ExecutionContext = {
      input: { ...input, message: blocks },
      frame: frame,
      currentState: AgentState.INITIALIZING,
      iteration: 0,
      maxIterations: DEFAULT_MAX_ITERATIONS,
    }
    const loop = new AgentChatLoop(context, this.appContainer, input.agentId)
    const res = await loop.execute()

    return res
  }

  private async resume(input: RunAgentInput) {
    if (!input.decision) {
      throw new Error('we are trying to resume but without any decision, it shouldnt happen');
    }

    const getPausedFrames = await this.appContainer.frameCRUD.getByStatus(input.runId, "suspended");
    for (const frame of getPausedFrames) {
      this.applyDecisionToFrame(frame, input.decision);
      await this.appContainer.frameCRUD.update(frame.frame_id, {
        pending_approvals: frame.pending_approvals
      });
    }
    const res = await this.restartLeaves(input);
    return res
  }

  async restartLeaves(input: RunAgentInput): Promise<AgentStackFrame> {
    const frameexec: Promise<AgentStackFrame>[] = [];
    const leaves = await this.appContainer.frameCRUD.getLeafFrames(input.runId);

    if (leaves.length === 0) {
      throw new Error("No leaf frames found for runId: " + input.runId);
    }

    for (const leaf of leaves) {
      const context: ExecutionContext = {
        input: input,
        frame: leaf,
        currentState: AgentState.INITIALIZING,
        iteration: 0,
        maxIterations: DEFAULT_MAX_ITERATIONS,
      };
      const loop = new AgentChatLoop(context, this.appContainer, leaf.agent_id);
      frameexec.push(loop.execute());
      await this.appContainer.frameCRUD.delete(leaf.frame_id);
    }

    const output_leaves = await Promise.all(frameexec);

    for (const ol of output_leaves) {
      if (detectnewleaf(ol) || !ol.parent_frame_id) {
        return ol;
      }

      const parent_frame = await this.appContainer.frameCRUD.getById(ol.parent_frame_id);
      if (!ol.answering_tool_call_id) {
        throw new Error('Since it has a parent frame it should have also a answering tool call id');
      }

      const tool_msg: LiteLLMMessage = {
        role: "tool",
        tool_call_id: ol.answering_tool_call_id,
        content: JSON.stringify(ol.history[ol.history.length - 1].content),
      };

      if (!parent_frame) throw new Error('parent frame not found in db');

      await this.appContainer.frameCRUD.update(parent_frame.frame_id, {
        history: [...parent_frame.history, tool_msg]
      });
    }

    return await this.restartLeaves(input);
  }
  /** Apply decision to the frame */
  private applyDecisionToFrame(
    frame: AgentStackFrame,
    decisions: Record<string, UserDecision>
  ) {
    /** No reference to the parameters of the class but we mutate directly the object
      * provided in parameter 
    */
    for (const approval of frame.pending_approvals) {
      const decision = decisions[approval.tool_call.id]
      if (decision) {
        approval.approval_status.approval = decision.approved ? 'approved' : 'rejected';
        if (approval.approval_status.approval === 'rejected') {
          approval.approval_status.feedback = decision.feedback;
        }
      }
    }
  }
}
