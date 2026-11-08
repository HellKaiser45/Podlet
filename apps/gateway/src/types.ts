import { t } from 'elysia'
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type {
  ChatCompletionTool,
  ChatCompletionChunk,
  ChatCompletionMessageToolCall,
  ChatCompletionMessageParam,
  ChatCompletionAssistantMessageParam,
  ChatCompletionUserMessageParam
} from "@podlet/types";

import type { AGUIEvent } from "@ag-ui/core";
type WithAgentId<T> = T & { AgentId: string };

//=========================================================
// Input validation
//=========================================================
const UserDecisionSchema = t.Object({
  approved: t.Boolean(),
  feedback: t.Optional(t.String()),
})

export const RunAgentInputSchema = t.Object({
  threadId: t.String(),
  runId: t.String(),
  parentRunId: t.Optional(t.String()),
  message: t.Unsafe<ChatCompletionUserMessageParam>(t.Any()),
  attachmentIds: t.Optional(t.Array(t.String())),
  agentId: t.String(),
  decision: t.Optional(t.Record(t.String(), UserDecisionSchema)),
})

// - - - - - - - 
export const FileUploadSchema = t.Object({
  runId: t.String(),
  files: t.Files()
})

export type FileUpload = typeof FileUploadSchema['static']


export type FileResponse = {
  name: string;
  vpath: string;
  id: string;
  type: "text" | "image"
}
// ===========================
// CUSTOM ERRORS
// ==========================
export class AgentToolSuspended extends Error {
  constructor(
    public readonly childFrameId: string,
    public readonly agentId: string,
  ) {
    super(`Child agent ${agentId} suspended (frame: ${childFrameId})`);
    this.name = "AgentToolSuspended";
  }
}

//===========================================================
/** MCP config */
export interface MCPConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface MCPInstance {
  client: Client;
  tools: ChatCompletionTool[]
}

//===========================================================
type ReasoningEffort = "low" | "medium" | "high" | "none";

//=======================================================================================
// API Input types
//=======================================================================================

/** HIL definition for the frontend to backend */
export interface UserDecision {
  /** if the HIL challenge is approved or not */
  approved: boolean;
  /** A feedback should be retrieved if the user rejected the HIL */
  feedback?: string;
}

/** Main Chat API input*/
export interface RunAgentInput {
  threadId: string
  runId: string
  parentRunId?: string
  message: ChatCompletionUserMessageParam
  attachmentIds?: string[]
  agentId: string
  decision?: Record<string, UserDecision>
}

//====================================================================================
// Events modified types
// ===================================================================================

export type CustomBaseEvent = WithAgentId<AGUIEvent>;

interface HeartbeatEvent {
  type: "heartbeat";
  timestamp: string;
}

export type StreamEvent = CustomBaseEvent | HeartbeatEvent;

//=======================================================================================
// Config related types
//=======================================================================================
/** Skill config */

/** Skill frontmatter */
export interface SkillFrontmatter {
  name: string;
  description: string;
}

export interface Skillneeded extends SkillFrontmatter {
  location: string;
}

/** ~/.podelet/models.json */

/** The wire protocol an entry is spoken to with. Resolved from `provider` (see system/providers.ts). */
export type Protocol = "openai" | "anthropic" | "google";

/**
 * Per-model opt-outs. These are the only tolerance left now that litellm's
 * `drop_params` net is gone: an undeclared quirk means the parameter is sent as-is.
 */
export interface ProviderQuirks {
  no_cache_control?: boolean;
  no_reasoning_effort?: boolean;
  no_stream_options?: boolean;
  anthropic_static_budget?: boolean;
  /** Emit `thinkingBudget: 0` for google when `agent.thinking` is `none`. */
  disable_thinking_on_none?: boolean;
  /**
   * Send the per-conversation `x-opencode-session` header, as the old Python
   * service did for opencode. Dynamic (it depends on the history), so it cannot
   * live in the static provider table; set on the `opencode` row only.
   */
  opencode_session?: boolean;
}

export interface ModelConfig {
  /** Provider name as documented by Podlet; looked up verbatim in PROVIDER_TABLE. */
  provider: string;
  /** Model id passed to the provider SDK. */
  model: string;
  api_key_name?: string;
  /**
   * @deprecated Not read by the request path: thinking moved to the agent
   * (`Agent.thinking`). The field is kept only so a stored legacy value can be
   * detected and reported: `system/providers.ts` turns it into an "unusable"
   * health reason and `api-routes/models-routes.ts` rejects it with 422.
   */
  reasoning_effort?: ReasoningEffort;
  base_url?: string;
  headers?: Record<string, string>;
  quirks?: ProviderQuirks;
  /** The chosen key variable may be absent (local inference servers). */
  api_key_optional?: boolean;
}

/** Response-only sidecar; never part of the stored config. */
export interface Health {
  status: "ok" | "warning" | "unusable";
  /** Present iff `status !== "ok"`, and names the offending field plus the fix. */
  reason?: string;
}

export type ModelWithHealth = ModelConfig & { health: Health };

/** ~/.podelet/agents/*.json */
export interface Agent {
  /** Agent name transmitted by the instance */
  agentId: string;
  /** Agent description as defined by the user */
  agentDescription: string;
  /** Model name - given by the provider not a custom name */
  model: string;
  /** System prompt of the agent */
  system_prompt: string;
  /* List of Mcps names available by to the agent (and they must be in the config file for mcps)*/
  mcps?: string[];
  /** List of skills names available to the agent (and they must be in the folder for skills)*/
  skills?: string[];
  /** List agent names to pass to the agent as tools */
  subAgents?: string[];
  /** if we want a particular output format */
  response_format?: Record<string, any>;
  /**
   * Thinking level, positional on the provider's own scale: `low` is its lowest,
   * `medium` its middle, `high` its highest. Default `none` (nothing is sent).
   */
  thinking?: AgentThinking;
}

export type AgentThinking = "low" | "medium" | "high" | "none";

//===================================================================================
// File system related types
// ==================================================================================




//===================================================================================
// Return types from the chat endpoint 
// ==================================================================================

/** LiteLLM backend I use seems to return something close to openai standard with come changes */
export interface LiteLLMStreamedChunk extends Omit<ChatCompletionChunk, "choices"> {
  choices: LiteLLMChoice[];
}

interface LiteLLMChoice extends Omit<ChatCompletionChunk.Choice, "delta"> {
  delta: LiteLLMDelta;
}

/** This is the difference from original delta because litellm handle and support different thinking properties and it is their way to do it */
export interface LiteLLMDelta extends ChatCompletionChunk.Choice.Delta {
  reasoning_content?: string | null;
  thinking_blocks?: ThinkingAnthropic[] | null;
}


export type ThinkingAnthropic =
  | {
      type: "thinking",
      thinking: string;
      signature: string;
    }
  | { type: "redacted_thinking"; data: string };

//======================================================================
//HIL Approval related stuff
//======================================================================
interface ApprovalStatus {
  approval: "approved" | "rejected" | "pending";
  feedback?: string;
}

export interface PendingApproval {
  tool_call: ChatCompletionMessageToolCall
  requires_approval: boolean;
  approval_status: ApprovalStatus;
  description?: string;
}


//=======================================================================
//Checkpoint Agent Stack Frame
//=======================================================================

export type LiteLLMMessage = (ChatCompletionMessageParam | ChatCompletionAssistantMessageParam) & {
  reasoning_content?: string | null;
  thinking_blocks?: ThinkingAnthropic[] | null;
}

export function isAssistantWithToolCalls(
  msg: LiteLLMMessage
): msg is Extract<LiteLLMMessage, { role: 'assistant' }> & { tool_calls: ChatCompletionMessageToolCall[] } {
  return msg.role === 'assistant' && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0;
}


export interface AgentStackFrame {
  frame_id: string;
  parent_frame_id?: string;
  answering_tool_call_id?: string;
  agent_id: string;
  history: LiteLLMMessage[];
  pending_approvals: PendingApproval[];
  status: "running" | "suspended" | "completed" | "error";
}



// ===========================
// CONTEXT
// ==========================
/**NOTE: This is the full agentState : the context of the execution 
 * It is for one and only one agent loop not the full context though
 *The full context is managed by a persistant checkpoint (loop vs orchestrator)
 * */

export enum AgentState {
  INITIALIZING = 'INITIALIZING',
  CALLING_LLM = 'CALLING_LLM',
  EXECUTING_TOOLS = 'EXECUTING_TOOLS',
  AWAITING_APPROVAL = 'AWAITING_APPROVAL',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

export interface ExecutionContext {
  input: RunAgentInput;
  frame: AgentStackFrame;
  currentState: AgentState;
  iteration: number;
  maxIterations: number;

  error?: string;
}

export const DEFAULT_MAX_ITERATIONS = 1000;

export function createContext(
  input: RunAgentInput,
  frame: AgentStackFrame,
  maxIterations?: number,
): ExecutionContext {
  return {
    input,
    frame,
    currentState: AgentState.INITIALIZING,
    iteration: 0,
    maxIterations: maxIterations ?? DEFAULT_MAX_ITERATIONS,
  }
}
