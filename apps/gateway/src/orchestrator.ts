import { EventType } from "@ag-ui/core";
import { AgentChatLoop } from "./agent-loop/chat-loop";
import AppContainer from "./runtime";
import { AgentStackFrame, RunAgentInput, UserDecision, ExecutionContext, AgentState, LiteLLMMessage } from "./types";
import { randomUUIDv7 } from "bun";
import { VirtualFileSystem } from "./system/sandbox";


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
    const conversationHistory = res.history.filter(m => {
      if (m.role === 'user') return true
      if (m.role === 'assistant' && !('tool_calls' in m && (m as any).tool_calls?.length)) return true
      return false
    })
    if (res.status === 'error' || res.status === 'running') {
      this.appContainer.eventManager[input.runId].push({
        AgentId: input.agentId,
        type: EventType.RUN_ERROR,
        message: `orchestrator error ${res.status}`,
        threadId: input.threadId,
        runId: input.runId,
      })
    }
    else {
      this.appContainer.eventManager[input.runId].push({
        AgentId: input.agentId,
        type: EventType.RUN_FINISHED,
        threadId: input.threadId,
        runId: input.runId,
        result: res,
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
    const start = new VirtualFileSystem(this.appContainer.initConfig.podeletDir, input.runId, input.cwd)
    const blocks = await start.generateContentBlock(input.attachmentIds ?? [], input.message)

    const frame = await this.initFrame(input.agentId, blocks, input.runId)
    const context: ExecutionContext = {
      input: { ...input, message: blocks },
      frame: frame,
      currentState: AgentState.INITIALIZING,
      iteration: 0,
      maxIterations: 10,
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

    for (const leaf of leaves) {
      const context: ExecutionContext = {
        input: input,
        frame: leaf,
        currentState: AgentState.INITIALIZING,
        iteration: 0,
        maxIterations: 10,
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

        if (approval.tool_call.type === "function") {
        }
      }
    }
  }
}
