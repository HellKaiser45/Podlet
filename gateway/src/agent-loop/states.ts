import { AgentStackFrame, LiteLLMMessage, RunAgentInput } from "../types";

export enum AgentState {
  INITIALIZING = 'INITIALIZING',
  CALLING_LLM = 'CALLING_LLM',
  PROCESSING_RESPONSE = 'PROCESSING_RESPONSE',
  EXECUTING_TOOLS = 'EXECUTING_TOOLS',
  AWAITING_APPROVAL = 'AWAITING_APPROVAL',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}


// ===========================
// CONTEXT
// ==========================
/**NOTE: This is the full agentState : the context of the execution */

export interface ExecutionContext {
  input: RunAgentInput;
  //TODO: Retrieve AgentConfig from input (so from the name)
  frame: AgentStackFrame;
  currentState: AgentState;
  iteration: number;
  maxIterations: number;

  lastMessage?: LiteLLMMessage;
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



