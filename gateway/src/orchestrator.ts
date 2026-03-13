
import { AgentChatLoop } from "./agent-loop/chat-loop";
import { AgentStackFrame, RunAgentInput, initFrame, UserDecision, ExecutionContext, AgentState, LiteLLMMessage } from "./types";
import { frameCRUD } from "./db/db_client";


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
    throw new Error("unexpected state")
  }
}

export class AgentOrchestrator {
  /** Main entry point to sort and route depending if we are resuming or not */
  async executeAgent(input: RunAgentInput) {

    const existing_checkpoint = await frameCRUD.getByRunId(input.runId)

    if (existing_checkpoint) {
      console.log(`📂 Found existing checkpoint for runId: ${input.runId}`);
      const output_frame = await this.resume(input)
    } else {
      console.log(`🆕 Starting new execution for runId: ${input.runId}`);
      const output_frame = await this.startNewExecution(input)
    }
  }

  /** Start a new execution for the agent */
  private async startNewExecution(input: RunAgentInput) {
    const frame = initFrame(input.agentId)

    const context: ExecutionContext = {
      input: input,
      frame: frame,
      currentState: AgentState.INITIALIZING,
      iteration: 0,
      maxIterations: 10,
    }

    const loop = await AgentChatLoop.create(context)

    return await loop.execute()
  }

  private async resume(
    input: RunAgentInput,
  ) {

    if (!input.decision) {
      throw new Error('we are trying to resume but without any decision, it shouldnt happen')
    }

    const getPausedFrames = await frameCRUD.getByStatus(input.runId, "suspended")
    for (const frame of getPausedFrames) {
      this.applyDecisionToFrame(frame, input.decision)
      await frameCRUD.update(frame.frame_id, {
        pending_approvals: frame.pending_approvals
      });
    }

    await this.restartLeaves(input)
  }

  async restartLeaves(input: RunAgentInput) {
    const frameexec: Promise<AgentStackFrame>[] = []
    for (const leaf of await frameCRUD.getLeafFrames(input.runId)) {

      const context: ExecutionContext = {
        input: input,
        frame: leaf,
        currentState: AgentState.EXECUTING_TOOLS,
        iteration: 0,
        maxIterations: 10,
      }
      const loop = await AgentChatLoop.create(context)
      frameexec.push(loop.execute())
    }

    const output_leaves = await Promise.all(frameexec)

    for (const ol of output_leaves) {
      if (detectnewleaf(ol) || !ol.parent_frame_id) {
        return
      }
      const parent_frame = await frameCRUD.getById(ol.parent_frame_id);
      if (!ol.answering_tool_call_id) { throw new Error('Since it has a perent frame it should have also a answering tool call id') }
      const tool_msg: LiteLLMMessage = {
        role: "tool",
        tool_call_id: ol.answering_tool_call_id,
        content: JSON.stringify(ol.history[ol.history.length - 1].content),
      }
      if (!parent_frame) { throw new Error('parent frame not found in db') }
      await frameCRUD.update(parent_frame?.frame_id, {
        history: [...parent_frame?.history, tool_msg]
      })
      await frameCRUD.delete(ol.frame_id)

    }
    await this.restartLeaves(input)
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

        if (approval.tool_call.type === "function") {
          console.log(
            `[${frame.frame_id.slice(0, 8)}] Tool ${approval.tool_call.function.name}: ${approval.approval_status.approval}`
          );
        }
      }
    }
  }
}
