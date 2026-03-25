import { ChatCompletionTool, ChatCompletionToolMessageParam } from 'openai/resources/index'
import { AgentChatLoop } from './../agent-loop/chat-loop'
import { AgentStackFrame, AgentToolSuspended, createContext, RunAgentInput } from '../types'
import AppContainer from '../runtime';


export class AgentToolManager {
  private container: AppContainer
  constructor(container: AppContainer) {
    this.container = container
  }

  async getAgentAsToolDefinition(agentIds: string[]): Promise<ChatCompletionTool[]> {
    const tools: ChatCompletionTool[] = [];
    for (const agentId of agentIds) {
      const agent = this.container.agentManager.agents[agentId]
      tools.push({
        type: "function",
        function: {
          name: `agent_${agentId}`,
          description: agent.agentDescription || `delegate task to ${agentId}`,
          parameters: {
            type: "object",
            properties: {
              task: { type: "string", description: "Task to delegate to the agent explained clearly in natural language and given with necessary piecies of context." }
            },
            required: ["task"]
          }
        }
      })
    }
    return tools
  }

  isAgentTool(toolname: string): boolean {
    return toolname.startsWith("agent_")
  }

  async execute(
    toolName: string,
    toolCallId: string,
    args: Record<string, any>,
    parentFrameid: string,
    runId: string,
    threadId: string,
  ): Promise<ChatCompletionToolMessageParam> {

    const agentId = toolName.replace("agent_", "");
    console.log(`🤖 Spawning sub-agent: ${agentId}`);

    const childFrame: AgentStackFrame = {
      frame_id: crypto.randomUUID(),
      parent_frame_id: parentFrameid,
      answering_tool_call_id: toolCallId,
      agent_id: agentId,
      history: [{ role: "user", content: args.task }],
      pending_approvals: [],
      status: "running",
    }

    const runagent: RunAgentInput = {
      message: args.task,
      agentId: agentId,
      runId: runId,
      threadId: threadId,
    }

    const agentContext = createContext(runagent, childFrame)

    const loop = new AgentChatLoop(agentContext, agentId)
    const result = await loop.execute()

    if (result.status === "completed") {
      return {
        role: "tool",
        tool_call_id: toolCallId,
        content: JSON.stringify(result.history[result.history.length - 1].content),
      }
    }

    else if (result.status === "suspended") {
      throw new AgentToolSuspended(childFrame.frame_id, childFrame.agent_id)
    }

    else {
      throw new Error(`Unexpected error in agent tool execution: ${result.status}`)
    }
  }
}

