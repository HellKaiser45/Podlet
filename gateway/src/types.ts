import {
  ChatCompletionMessage,
  ChatCompletionTool,
  ChatCompletionChunk,
  ChatCompletionMessageToolCall,
  ChatCompletionMessageParam,
  ChatCompletionAssistantMessageParam
} from 'openai/resources/chat/completions';


//=======================================================================================
// API Input types
//=======================================================================================

//TODO: Store the agents in a file : JSON OR YAML, and Add a file for crud operations
/** Agent definition for the frontend to backend */
export interface Agent {
  /** Agent name transmitted by the instance */
  agentId: string;
  /** Agent description as defined by the user */
  agentDescription: string;
  /** LLM provider */
  provider: string;
  /** Model name - given by the provider not a custom name */
  model: string;
  /** System prompt of the agent */
  // TODO: implement a file system and folder to store system prompts
  system_prompt: string;
  /* List of Mcps names available by to the agent (and they must be in the config file for mcps)*/
  mcps?: string[];
  /** List of skills names available to the agent (and they must be in the folder for skills)*/
  //TODO: implement a folder for skills and a class to read the skills and inject them
  skills?: string[];
  /** List agent names to pass to the agent as tools */
  subAgents?: string[];
  /** if we want a particular output format */
  response_format?: Record<string, any>;
}

//TODO: 2 possibilities : like the skills or like claude code does with in project .files
//I prefer the first one though it is less flexible but easier
//to manage for me and the user as well I believe. I am not sure if it should be part
//of the agent definition or not. 
interface Context {
  description: string;
  /** The actual content of the context */
  value: string;
}

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

export type ApprovalStatus = "approved" | "rejected" | "pending";


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

export type FrameStatus = "suspended" | "running" | "completed" | "failed";

export interface LiteLLMMessage extends ChatCompletionAssistantMessageParam {
  reasoning_content?: string | null;
  thinking_blocks?: ThinkingAnthropic[] | null;
}

export interface AgentStackFrame {
  frame_id: string;
  parent_frame_id?: string;
  agent_id: string;
  depth: number;

  history: LiteLLMMessage[];
  pending_approvals: PendingApproval[];

  status: FrameStatus;
}

/** The full Agent State stack to resume properly */
export interface Checkpoint {
  checkpoint_id: string;
  run_id: string;
  /** frame_id -> AgentStackFrame */
  frames: Record<string, AgentStackFrame>;
  current_frame_id: string;
}
