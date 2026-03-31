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
          description: `Delegate a task to ${agentId}:
The agent has the following description : ${agent.agentDescription}`,
          parameters: {
            type: "object",
            properties: {
              task: { type: "string", description: "Task to delegate to the agent explained clearly in natural language and given with necessary piecies of context." },
              previous_action_summary: {
                type: "string",
                description: "Brief summary of what happened in the previous step (e.g., 'Created folder X')."
              },
              workspace_path: {
                type: "string",
                description: "The current working directory where operations should happen."
              },
              relevant_files: {
                type: "array",
                items: { type: "string" },
                description: "List of file paths created or discussed so far."
              },
            },
            required: ["task"]
          },
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
    args: Record<string, unknown>,
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
      history: [{ role: "user", content: JSON.stringify(args) }],
      pending_approvals: [],
      status: "running",
    }

    const runagent: RunAgentInput = {
      message: { role: "user", content: JSON.stringify(args) },
      forwardedProps: {
        agentId: agentId,
      },
      runId: runId,
      threadId: threadId,
      tools: [],
      context: [],
      state: {},
    }

    const agentContext = createContext(runagent, childFrame)

    const loop = new AgentChatLoop(agentContext, this.container, agentId)
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

