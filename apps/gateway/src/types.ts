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

import type { RunFinishedEvent as AGUIRunFinishedEvent, AGUIEvent } from "@ag-ui/core";
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
  cwd: t.Optional(t.String()),
  message: t.Unsafe<ChatCompletionUserMessageParam>(t.Any()),
  attachmentIds: t.Optional(t.Array(t.String())),
  agentId: t.String(),
  decision: t.Optional(t.Record(t.String(), UserDecisionSchema)),
})

// - - - - - - - - 
export const FileUploadSchema = t.Object({
  runId: t.String(),
  cwd: t.Optional(t.String()),
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

export class TokenLimitError extends Error {
  public readonly code: string;
  constructor(message: string, code: string = 'TOKEN_LIMIT_EXCEEDED') {
    super(message);
    this.name = 'TokenLimitError';
    this.code = code;
  }
}

//===========================================================
/** MCP config */
export interface MCPConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface MCPInstance {
  client: Client;
  tools: ChatCompletionTool[]
}

//===========================================================
/** Payload to send to the chat endpoint */
export interface AgentRequest {
  // Core Model Info
  provider: string;
  model: string;
  system_prompt: string;
  history: Array<{ role: string; content: string;[key: string]: any }>;

  // Environment/Config
  configpath: string;
  api_key_name?: string;

  // Model Parameters
  temperature?: number;
  max_tokens?: number;
  base_url?: string;

  // Advanced
  tools?: any[];
  response_format?: Record<string, any>;
}

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
  cwd?: string
  agentId: string
  decision?: Record<string, UserDecision>
}

//====================================================================================
// Events modified types
// ===================================================================================

export type RunFinishedEvent = AGUIRunFinishedEvent & {
  result: AgentStackFrame
}

export type CustomBaseEvent = WithAgentId<AGUIEvent>;

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
export interface ModelConfig {
  provider: string;
  model: string;
  api_key_name?: string;
  temperature?: number;
  max_tokens?: number;
  base_url?: string;
  /** Model context window in tokens. Default: 128000 */
  context_window?: number;
}

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
}

/** ~/.podelet/mcps.json (Standard MCP format) */
export interface MCPServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

//===================================================================================
// File system related types
// ==================================================================================
export const VIRTUAL_SCHEMES = ["/home/hellkaiser/.podlet/workspace/858d132d-4d20-47be-8c99-8cf8de52e1db/", "/home/hellkaiser/.podlet/artifacts/858d132d-4d20-47be-8c99-8cf8de52e1db/", "/home/hellkaiser/.podlet/skills/"] as const;
export type VirtualScheme = (typeof VIRTUAL_SCHEMES)[number];



//===================================================================================
// Return types from the chat endpoint 
// ==================================================================================

/** LiteLLM backend I use seems to return something close to openai standard with come changes */
export interface LiteLLMStreamedChunk extends Omit<ChatCompletionChunk, "choices"> {
  choices: LiteLLMChoice[];
}

export interface LiteLLMChoice extends Omit<ChatCompletionChunk.Choice, "delta"> {
  delta: LiteLLMDelta;
}

/** This is the difference from original delta because litellm handle and support different thinking properties and it is their way to do it */
export interface LiteLLMDelta extends ChatCompletionChunk.Choice.Delta {
  reasoning_content?: string | null;
  thinking_blocks?: ThinkingAnthropic[] | null;
}


export interface ThinkingAnthropic {
  type: "thinking",
  thinking: string;
  signature: "string";
}

//======================================================================
//HIL Approval related stuff
//======================================================================
export interface ApprovalStatus {
  approval: "approved" | "rejected" | "pending";
  feedback?: string;
}

export interface PendingApproval {
  tool_call: ChatCompletionMessageToolCall
  requires_approval: boolean;
  approval_status: ApprovalStatus;
  description?: string;
}

export interface HILConfig {
  enabled: boolean;
  sensitive_tools: string[];
  auto_unapprove_editing_tools: boolean;
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
  PROCESSING_RESPONSE = 'PROCESSING_RESPONSE',
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

export function createContext(
  input: RunAgentInput,
  frame: AgentStackFrame,
): ExecutionContext {
  return {
    input,
    frame,
    currentState: AgentState.INITIALIZING,
    iteration: 0,
    maxIterations: 10,
  }
}
