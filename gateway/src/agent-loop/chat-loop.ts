import { ChatCompletionStream } from "openai/lib/ChatCompletionStream";
import { AgentCRUDClient } from "../agent-config-manager";
import { AgentClient, MessageAccumulator } from "../agent_client";
import { MCPManager } from "../tools/mcp/client";
import { AgentRequest, AgentStackFrame, RunAgentInput, Checkpoint } from "../types";
import { AgentState, createContext, ExecutionContext } from "./states";
import { HilManager } from "../hil/hil-manager";


class AgentChatLoop {
  private agentshandler: AgentCRUDClient = new AgentCRUDClient();
  private llmclient: AgentClient = new AgentClient();

  async execute(
    input: RunAgentInput,
    frame: AgentStackFrame,
  ) {
    const context = createContext(input, frame)

    while (context.currentState !== AgentState.COMPLETED && context.currentState !== AgentState.FAILED) {

      context.iteration++;
      console.log(`\n🔄 [${input.runId}] State: ${context.currentState} (Iteration: ${context.iteration})`);
      switch (context.currentState) {
        case AgentState.INITIALIZING:
          break;
        case AgentState.CALLING_LLM:
          await this.callLLM(input, context);
          break;
        case AgentState.PROCESSING_RESPONSE:
          const message = context.lastMessage;
          if (message?.tool_calls && message.tool_calls.length > 0) {
            const hilManager = new HilManager();
            const needsApproval = hilManager.hillCheck(message);
            
            if (needsApproval) {
              context.frame.pending_approvals = hilManager.getApprovals();
              this.transitionTo(context, AgentState.AWAITING_APPROVAL);
            } else {
              this.transitionTo(context, AgentState.EXECUTING_TOOLS);
            }
          } else {
            // No tool calls, task is complete
            this.transitionTo(context, AgentState.COMPLETED);
          }
          break;
        case AgentState.AWAITING_APPROVAL:
          // Check if any approvals are still pending
          const hasPendingApprovals = context.frame.pending_approvals?.some(
            approval => approval.approval_status === "pending"
          );
          
          if (hasPendingApprovals) {
            // Exit loop to wait for external API to update frame and resume
            return;
          } else {
            // All approvals resolved, proceed to execute tools
            this.transitionTo(context, AgentState.EXECUTING_TOOLS);
          }
          break;
        case AgentState.EXECUTING_TOOLS:
          await this.executeTools(input, context);
          break;
      }
    }

  }

  private transitionTo(context: ExecutionContext, newState: AgentState) {
    console.log(`${context.currentState} -> ${newState}`);
    context.currentState = newState;
  }

  private async callLLM(input: RunAgentInput, context: ExecutionContext) {
    const agentdef = await this.agentshandler.loadAgent(input.agentId)
    const accu = new MessageAccumulator();
    const mcp = await MCPManager.create(agentdef.mcps)


    const agentReq: AgentRequest = {
      provider: agentdef.provider,
      system_prompt: agentdef.system_prompt,
      model: agentdef.model,
      tools: mcp.getTools(),
      response_format: agentdef.response_format,
      history: context.frame.history,
    }

    for await (const choice of this.llmclient.chatStream(agentReq)) {
      accu.construcMessage(choice.choices[0].delta)
      let message

      switch (choice.choices[0].finish_reason) {
        case null:
          continue;
        case "tool_calls":
        case "stop":
          message = accu.buildMessage();
          context.frame.history.push(message);
          context.lastMessage = message;
          this.transitionTo(context, AgentState.PROCESSING_RESPONSE);
          return;
        case "content_filter":
        case "length":
          this.transitionTo(context, AgentState.FAILED);
          return;
      }
    }
  }

  private async executeTools(input: RunAgentInput, context: ExecutionContext) {
    const agentdef = await this.agentshandler.loadAgent(input.agentId);
    const mcp = await MCPManager.create(agentdef.mcps);
    
    const message = context.lastMessage;
    if (!message?.tool_calls || message.tool_calls.length === 0) {
      this.transitionTo(context, AgentState.CALLING_LLM);
      return;
    }

    const toolResults = [];
    
    for (const call of message.tool_calls) {
      // Check if this tool requires approval
      const approval = context.frame.pending_approvals?.find(
        a => a.tool_call.id === call.id
      );
      
      let resultContent: string;
      
      if (approval && approval.approval_status === "rejected") {
        // Tool was rejected by user
        resultContent = "Tool execution rejected by user.";
      } else {
        // Execute the tool (either approved or doesn't require approval)
        try {
          const args = JSON.parse(call.function.arguments);
          const result = await mcp.executeTool(call.function.name, args);
          resultContent = JSON.stringify(result);
        } catch (error) {
          resultContent = `Error: ${error.message}`;
        }
      }
      
      toolResults.push({
        role: "tool",
        tool_call_id: call.id,
        content: resultContent
      });
    }

    // Add tool results to history
    context.frame.history.push(...toolResults);
    
    // Clear pending approvals after execution
    context.frame.pending_approvals = [];
    
    // Transition back to CALLING_LLM to get the model's response to tool results
    this.transitionTo(context, AgentState.CALLING_LLM);
  }
}
