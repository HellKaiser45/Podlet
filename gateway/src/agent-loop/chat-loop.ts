import { MessageAccumulator } from "../agent_client";
import { AgentStackFrame, Agent, ExecutionContext, AgentState, AgentToolSuspended, LiteLLMAssistantMessage, LiteLLMMessage } from "../types";
import { HilManager } from "../hil/hil-manager";
import { ChatCompletionMessageToolCall } from "openai/resources/index";
import { CoreToolsManager } from "../tools/core/core_tools";
import AppContainer from "../runtime";

export class AgentChatLoop {
  private context: ExecutionContext;
  private agentDef: Agent;
  private hilManager = new HilManager;
  private coreToolsManager = new CoreToolsManager;
  private appContainer: AppContainer;

  constructor(
    ex: ExecutionContext,
    appcontainer: AppContainer,
    agentId: string,
  ) {
    this.appContainer = appcontainer
    this.agentDef = this.appContainer.agentManager.agents[agentId]
    this.context = ex
  }

  async execute(): Promise<AgentStackFrame> {
    while (true) {
      switch (this.context.currentState) {
        case AgentState.INITIALIZING: {
          //check basically if we are resuming or not
          for (const mcp of this.agentDef.mcps || []) { await this.appContainer.mcpManager.startserver(mcp) }
          if (this.context.frame.pending_approvals && this.context.frame.pending_approvals.length > 0) {
            this.transitionTo(AgentState.EXECUTING_TOOLS)
          } else {
            this.transitionTo(AgentState.CALLING_LLM);
          }
          break;
        }
        case AgentState.CALLING_LLM: {
          await this.callLLM();
          break;
        }
        case AgentState.EXECUTING_TOOLS:
          await this.ToolsNode()
          break;
        case AgentState.AWAITING_APPROVAL:
          this.context.frame.status = "suspended";
          await this.appContainer.frameCRUD.create(this.context.frame, this.context.input.runId);
          console.log(`⏸️  Suspended needing Hil`);
          console.log('-> frame:', this.context.frame.frame_id)
          console.log('Pending approvals:', JSON.stringify(this.context.frame.pending_approvals, null, 2));
          return this.context.frame;
        case AgentState.COMPLETED:
          this.context.frame.status = "completed";
          console.log('result:', this.context.frame.history[this.context.frame.history.length - 1].content)
          return this.context.frame;
        case AgentState.FAILED:
          throw new Error("Agent failed");
      }
    }
  }

  private transitionTo(newState: AgentState) {
    console.log(`${this.context.currentState} -> ${newState}`);
    this.context.currentState = newState;
  }

  private async callLLM() {
    const accu = new MessageAccumulator();

    for await (const choice of this.appContainer.agentClient.chatStream(this.agentDef.agentId, this.context.frame.history)) {
      accu.constructMessage(choice.choices[0].delta)

      switch (choice.choices[0].finish_reason) {
        case null:
          continue;
        case "tool_calls":
        case "stop":
          const message = accu.buildMessage();
          this.context.frame.history.push(message);
          break;
        case "content_filter":
        case "length":
          this.transitionTo(AgentState.FAILED)
          return
      }
    }
    const lastMessage = this.context.frame.history[this.context.frame.history.length - 1] as LiteLLMAssistantMessage;
    if (lastMessage.tool_calls && lastMessage.tool_calls.length > 0) {
      this.transitionTo(AgentState.EXECUTING_TOOLS)
    } else {
      this.transitionTo(AgentState.COMPLETED)
    }
  }

  private async executeTools(calls: ChatCompletionMessageToolCall[]) {
    const tool_promises: Promise<LiteLLMMessage>[] = [];

    for (const call of calls) {
      if (call.type === "function") {
        try {
          const args = JSON.parse(call.function.arguments);
          console.log(`🔧 ${call.function.name}(${JSON.stringify(args)})`);

          if (this.coreToolsManager?.isCoreTool(call.function.name)) {
            tool_promises.push(this.coreToolsManager.execute(call.function.name, call.id, args));
          } else if (this.appContainer.agentToolsManager.isAgentTool(call.function.name)) {
            tool_promises.push(this.appContainer.agentToolsManager.execute(
              call.function.name,
              call.id,
              args,
              this.context.frame.frame_id,
              this.context.input.runId,
              this.context.input.threadId
            ));
          } else if (this.appContainer.mcpManager.isRunning(call.function.name)) {
            tool_promises.push(this.appContainer.mcpManager.call(call.function.name, call.id, args));
          } else {
            throw new Error(`Tool not found: ${call.function.name}`);
          }
        } catch (e) {
          const error = e instanceof Error ? e : new Error(String(e));
          tool_promises.push(Promise.resolve({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify({ error: `Failed to execute: ${error.message}` })
          }));
        }
      }
    }

    const tool_results = await Promise.allSettled(tool_promises);

    // Check for child suspension
    const suspendedChild = tool_results.find(
      r => r.status === "rejected" && r.reason instanceof AgentToolSuspended
    );

    // Check for other errors
    const otherErrors = tool_results.filter(
      (r): r is PromiseRejectedResult =>
        r.status === "rejected" && !(r.reason instanceof AgentToolSuspended)
    );

    if (otherErrors.length > 0) {
      console.error("Tool execution errors:", otherErrors);
      // Push error messages to history
      for (const err of otherErrors) {
        // Need to match error to original call - this is tricky with Promise.allSettled
        // For now, log the error
        console.error(err.reason);
      }
    }

    // Push successful results
    const completedTools = tool_results
      .filter(r => r.status === "fulfilled")
      .map(r => r.value);

    this.context.frame.history.push(...completedTools);

    // If child suspended, save and exit
    if (suspendedChild) {
      this.transitionTo(AgentState.AWAITING_APPROVAL);
      return;
    }

  }


  private async ToolsNode() {
    const lastAssistantMessage = this.context.frame.history.findLast(
      m => m.role === 'assistant'
    ) as LiteLLMAssistantMessage;

    if (!lastAssistantMessage?.tool_calls) {
      throw new Error('No assistant message with tool calls');
    }

    const lastAssistantIndex = this.context.frame.history.findLastIndex(m => m.role === 'assistant');
    const answeredIds = new Set(
      this.context.frame.history
        .slice(lastAssistantIndex + 1)
        .filter(m => m.role === 'tool')
        .map(m => m.tool_call_id)
    );

    const unanswered = lastAssistantMessage.tool_calls.filter(tc => !answeredIds.has(tc.id));
    console.log(`🔧 Unanswered tool calls: ${unanswered.length}`);

    const toExecute: ChatCompletionMessageToolCall[] = [];
    const toReject: ChatCompletionMessageToolCall[] = [];
    const needsHILCheck: ChatCompletionMessageToolCall[] = [];

    for (const call of unanswered) {
      const approval = this.context.frame.pending_approvals.find(ap => ap.tool_call.id === call.id);

      if (!approval) {
        needsHILCheck.push(call);
      } else if (approval.approval_status.approval === 'approved') {
        toExecute.push(call);
      } else if (approval.approval_status.approval === 'rejected') {
        toReject.push(call);
      }
    }

    console.log(`📊 Categorized: execute=${toExecute.length}, reject=${toReject.length}, needsHIL=${needsHILCheck.length}`);

    // Push rejection messages
    for (const call of toReject) {
      const approval = this.context.frame.pending_approvals.find(ap => ap.tool_call.id === call.id);
      if (!approval) continue;
      const toolName = call.type === 'function' ? call.function.name : call.id;
      console.log(`❌ Rejected: ${toolName}`);
      this.context.frame.history.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify({
          error: "Rejected by user",
          feedback: approval.approval_status.feedback
        })
      });
    }
    // Remove rejected approvals
    const rejectedIds = new Set(toReject.map(t => t.id));
    this.context.frame.pending_approvals = this.context.frame.pending_approvals.filter(
      ap => !rejectedIds.has(ap.tool_call.id)
    );

    // Check if unchecked tools need HIL
    if (needsHILCheck.length > 0) {
      const newApprovals = this.hilManager.hilCheck(needsHILCheck);
      console.log(`🛡️  HIL check: ${newApprovals.length} tools require approval`);

      if (newApprovals.length > 0) {
        this.context.frame.pending_approvals.push(...newApprovals);
      } else {
        toExecute.push(...needsHILCheck);
      }
    }

    if (toExecute.length > 0) {
      const toolNames = toExecute.map(t =>
        t.type === 'function' ? t.function.name : t.id
      );
      await this.executeTools(toExecute);
      console.log(`✅ Execution complete`);

      // Remove executed approvals
      const executedIds = new Set(toExecute.map(t => t.id));
      this.context.frame.pending_approvals = this.context.frame.pending_approvals.filter(
        ap => !executedIds.has(ap.tool_call.id)
      );
    }

    // Check final state
    const pendingCount = this.context.frame.pending_approvals.filter(
      ap => ap.approval_status.approval === "pending"
    ).length;

    if (pendingCount > 0) {
      console.log(`⏸️  ${pendingCount} tools awaiting approval`);
      this.transitionTo(AgentState.AWAITING_APPROVAL);
      return;
    }

    this.transitionTo(AgentState.CALLING_LLM);
  }
}

