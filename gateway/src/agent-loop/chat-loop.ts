import { AgentCRUDClient } from "../agent-config-manager";
import { AgentClient, MessageAccumulator } from "../agent_client";
import { MCPManager } from "../tools/mcp/client";
import { AgentRequest, AgentStackFrame, RunAgentInput, Agent, ExecutionContext, AgentState, AgentToolSuspended, LiteLLMAssistantMessage } from "../types";
import { HilManager } from "../hil/hil-manager";
import { ChatCompletionMessageToolCall, ChatCompletionToolMessageParam } from "openai/resources/index";
import { CoreToolsManager } from "../tools/core/core_tools";
import { AgentToolManager } from "../tools/agents-as-tools";
import { frameCRUD } from "../db/db_client";




export class AgentChatLoop {
  private agentsHandler = new AgentCRUDClient();
  private llmClient = new AgentClient();
  private context: ExecutionContext;
  private agentDef: Agent;
  private mcpManager: MCPManager;
  private hilManager: HilManager;
  private coreToolsManager: CoreToolsManager;
  private agentToolManager: AgentToolManager;

  private constructor(
    ex: ExecutionContext,
    agentDef: Agent,
    mcpManager: MCPManager
  ) {
    this.context = ex;
    this.agentDef = agentDef;
    this.mcpManager = mcpManager;
    this.hilManager = new HilManager();
    this.coreToolsManager = new CoreToolsManager();
    this.agentToolManager = new AgentToolManager(this.agentsHandler);
  }

  static async create(ex: ExecutionContext): Promise<AgentChatLoop> {
    const agentsHandler = new AgentCRUDClient();
    const agentDef = await agentsHandler.loadAgent(ex.input.agentId);
    const mcpManager = await MCPManager.create(agentDef.mcps);

    return new AgentChatLoop(ex, agentDef, mcpManager);
  }

  async execute(): Promise<AgentStackFrame> {
    while (true) {
      switch (this.context.currentState) {
        case AgentState.INITIALIZING: {
          //check basically if we are resuming or not
          if (this.context.frame.pending_approvals && this.context.frame.pending_approvals.length > 0) {
            this.transitionTo(this.context, AgentState.EXECUTING_TOOLS)
          }
          this.transitionTo(this.context, AgentState.CALLING_LLM);
          break;
        }
        case AgentState.CALLING_LLM: {
          await this.callLLM();
          break;
        }
        case AgentState.EXECUTING_TOOLS:
          this.ToolsNode()
          break;
      }
    }
  }

  private transitionTo(context: ExecutionContext, newState: AgentState) {
    console.log(`${context.currentState} -> ${newState}`);
    context.currentState = newState;
  }

  private async callLLM() {
    const accu = new MessageAccumulator();
    const tools = []
    //Add mcp tools
    for (const tool of this.mcpManager.getTools()) { tools.push(tool) }
    //Add sub agents
    if (this.agentDef.subAgents) {
      for (const AGTool of this.agentDef.subAgents) { tools.push(await this.agentToolManager.getAgentAsToolDefinition(AGTool)) }
    }
    //Add core tools
    [...tools, this.coreToolsManager.getToolDefinitions()]


    const agentReq: AgentRequest = {
      provider: this.agentDef.provider,
      system_prompt: this.agentDef.system_prompt,
      model: this.agentDef.model,
      tools: tools,
      response_format: this.agentDef.response_format,
      history: this.context.frame.history,
    }

    for await (const choice of this.llmClient.chatStream(agentReq)) {
      accu.construcMessage(choice.choices[0].delta)

      switch (choice.choices[0].finish_reason) {
        case null:
          continue;
        case "tool_calls":
        case "stop":
          const message = accu.buildMessage();
          this.context.frame.history.push(message);
        case "content_filter":
        case "length":
          this.transitionTo(this.context, AgentState.FAILED)
          return
      }
    }
    const lastMessage = this.context.frame.history[this.context.frame.history.length - 1] as LiteLLMAssistantMessage;
    if (lastMessage.tool_calls && lastMessage.tool_calls.length > 0) {
      this.transitionTo(this.context, AgentState.EXECUTING_TOOLS)
    }
    this.transitionTo(this.context, AgentState.COMPLETED)

  }

  private async executeTools(calls: ChatCompletionMessageToolCall[]) {
    const tool_promises: Promise<ChatCompletionToolMessageParam>[] = []
    for (const call of calls) {
      //NOTE: for now there is a scope issue with the mcp instance where i need to check also here 
      //so maybe i should review all instances and functions parameters in general

      if (call.type === "function") {
        const args = JSON.parse(call.function.arguments);
        if (this.coreToolsManager?.isCoreTool(call.function.name)) {
          tool_promises.push(this.coreToolsManager.execute(call.function.name, call.id, args))
        } else if (this.agentToolManager?.isAgentTool(call.function.name)) {
          tool_promises.push(this.agentToolManager.execute(call.function.name, call.id, args, this.context.frame.frame_id, this.context.input.runId, this.context.input.threadId))
        }
        else if (this.mcpManager.isRunning(call.function.name)) {
          tool_promises.push(this.mcpManager.call(call.function.name, call.id, args));

        } else {
          throw new Error(`Tool not found: ${call.function.name}`);
        }
      }
    }

    const tool_results = await Promise.allSettled(tool_promises)
    //NOTE: allSettled returns a wrapper object 

    const suspendedChild = tool_results.find(r => r.status === "rejected" && r.reason instanceof AgentToolSuspended);
    const completedChild = tool_results.filter(r => r.status === "fulfilled").map(r => r.value)
    const unknownsuspendedChild = tool_results.find(r => r.status === "rejected" && r.reason! instanceof AgentToolSuspended)

    if (unknownsuspendedChild) {
      throw new Error(`Unknown error in tool execution: ${unknownsuspendedChild}`)
    }
    //TODO: we need also to handle the case of rejected but not with AgentToolSuspended

    this.context.frame.history.push(...completedChild)

    if (suspendedChild) {
      this.context.frame.status = "suspended"
      await frameCRUD.create(this.context.frame, this.context.input.runId);
      return
    }
    else {
      this.transitionTo(this.context, AgentState.CALLING_LLM);
    }


  }

  private async ToolsNode() {

    //check if the last message contains a tool call
    const lastAssistantIndex = this.context.frame.history.findLastIndex(m => m.role === 'assistant');
    const lastAssistantMessage = this.context.frame.history.findLast(m => m.role === 'assistant');
    if (!lastAssistantIndex || !lastAssistantMessage) { throw new Error('We are trying to execute tool but the there is no assistant message in the history') }
    const remainingMessages = lastAssistantIndex !== -1 ? this.context.frame.history.slice(lastAssistantIndex + 1) : [];
    if (remainingMessages.some(msg => msg.role !== "tool")) {
      throw new Error("Unexpected non-tool messages after assistant")
    }


    //case 1 - No messages after last assistant
    if (remainingMessages.length === 0) {
      //1 - Hill Check
      const hils = this.hilManager.hilCheck(lastAssistantMessage)
      if (hils) {
        this.context.frame.pending_approvals = this.hilManager.getApprovals()
        this.transitionTo(this.context, AgentState.AWAITING_APPROVAL)
      }
      //Add tool executions
      return
    }

    //case 2 -
    const pending_approvals = this.context.frame.pending_approvals
    const allToolCalls = new Set(lastAssistantMessage.tool_calls?.map(tc => tc.id))
    const alreadyAnsweredtoolcalls = new Set(remainingMessages.filter(m => m.role === 'tool').map(m => m.tool_call_id))

    const remainingToolCallstoanswer = allToolCalls.difference(alreadyAnsweredtoolcalls)


    const tool_calls_availaible = lastAssistantMessage.tool_calls?.filter(tc => remainingToolCallstoanswer.has(tc.id)) || []
    const approvedHil = pending_approvals.filter(ap => ap.approval_status.approval === "approved")
    const approvedIds = new Set(approvedHil.map(ap => ap.tool_call.id));
    const tool_calls_to_send = tool_calls_availaible.filter(tc => approvedIds.has(tc.id));

    //case 2A - ALL missing tool calls have a valid hil
    if (pending_approvals.every(ap => remainingToolCallstoanswer.has(ap.tool_call.id))) {
      //in this case just check if the tool call is approved or not and push

      const rejectedToolCalls = tool_calls_availaible.filter(tc => !approvedIds.has(tc.id))
      await this.executeTools(tool_calls_to_send)
      for (const tc of rejectedToolCalls) {
        const approval = pending_approvals.find(ap => ap.tool_call.id === tc.id);
        this.context.frame.history.push({
          role: "tool",
          tool_call_id: tc.id,
          content: JSON.stringify({ error: "Rejected", feedback: approval?.approval_status.feedback })
        });
      }
      return
    }

    //case 2B - some tool calls are missing
    if (pending_approvals.some(ap => remainingToolCallstoanswer.has(ap.tool_call.id))) {
      //in this case execute what could be executed and do the hil check on the rest.
      const rejectedHil = pending_approvals.filter(ap => ap.approval_status.approval === "rejected");
      const rejectedIds = new Set(rejectedHil.map(ap => ap.tool_call.id));
      const rejectedToolCalls = tool_calls_availaible.filter(tc => rejectedIds.has(tc.id));


      const pendingToolCalls = tool_calls_availaible.filter(tc =>
        !approvedIds.has(tc.id) && !rejectedIds.has(tc.id)
      );

      const tool_calls_to_send(),
      return
    }


  }

}
