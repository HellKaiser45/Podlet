import {
  ChatCompletionTool,
  ChatCompletionChunk,
  ChatCompletionMessageToolCall,
  ChatCompletionMessageParam,
  ChatCompletionAssistantMessageParam
} from 'openai/resources/chat/completions';
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { randomUUIDv7 } from "bun";
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

/** ~/.podelet/models.json */
export interface modelConfig {
  provider: string;
  model: string;
  base_url?: string;
  api_key?: string;
  api_key_env?: string;
  temperature?: number;
  max_tokens?: number;
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


//=======================================================================================
// API Input types
//=======================================================================================


/** HIL definition for the frontend to backend */
export interface UserDecision {
  /** if the HIL challenge is approved or not */
  approved: boolean;
  /** A feedback should be retrieved if the user rejected the HIL */
  feedback?: string;  // Optional reason if rejected
}

/** Main Chat API input*/
export interface RunAgentInput {
  /** Message from the user 
   * we don't let the frontend handle the history
   * so no need to send the history to the backend */
  message?: string;
  /** Name of the agent to run 
   * it could de source of error if the agent is renamed 
   * while human in the loop is ongoing */
  agentId: string;
  runId: string;
  /** ID of the full conversation */
  threadId: string;
  /**  Id of the checkpoint to resume from */
  checkpoint_id?: string;
  /** the Record is actually toolcallid , userDecision */
  decision?: Record<string, UserDecision>;
}

/** Payload to send to the chat endpoint */
export interface AgentRequest {
  provider: string;
  system_prompt: string;
  model: string;
  history: LiteLLMMessage[];
  tools?: ChatCompletionTool[];
  response_format?: Record<string, any>;
}

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

export type LiteLLMAssistantMessage = ChatCompletionAssistantMessageParam & {
  reasoning_content?: string | null;
  thinking_blocks?: ThinkingAnthropic[] | null;
}

export interface AgentStackFrame {
  frame_id: string;
  parent_frame_id?: string;
  answering_tool_call_id?: string;
  agent_id: string;
  history: LiteLLMMessage[];
  pending_approvals: PendingApproval[];
  status: "running" | "suspended" | "completed";
}

export function initFrame(agent: string, message: string): AgentStackFrame {
  const userMessage = {
    role: "user",
    content: message
  } as LiteLLMMessage
  return {
    frame_id: randomUUIDv7(),
    agent_id: agent,
    history: [userMessage],
    pending_approvals: [],
    status: "running",
  }
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

//==============================
// CONFIG
// =============================

export interface AppConfig {
  podeletDir: string;
  dbName: string;
  llmApiUrl: string;
  appPort: number;
  enableWatchers: boolean;
}
