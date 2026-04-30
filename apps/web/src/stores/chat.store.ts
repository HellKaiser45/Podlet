import { createStore, produce } from "solid-js/store";
import type { ChatCompletionMessageParam } from "@podlet/types";
import { api } from "../utils/api/share.api";
import { createSignal } from "solid-js";
import { attachments } from "./attachements.store";
import { selectedAgent } from "./chatInput.store";
import { revalidate } from "@solidjs/router";

export const [runId, setRunId] = createSignal<string>();

export interface ToolCall {
  id: string;
  name: string;
  args?: string;
  result?: string;
}

export interface PendingApproval {
  tool_call: {
    id: string;
    type: string;
    function: { name: string; arguments: string; };
  };
  approval_status: { approval: string; feedback?: string; };
  description?: string;
}

export interface Conversation {
  label?: string;
  status: 'idle' | 'running' | 'loading' | 'awaiting_approval';
  messages: ChatCompletionMessageParam[];
  tools: ToolCall[];
  subagents: Record<string, ChatCompletionMessageParam[]>;
  pendingApprovals: PendingApproval[];
  error?: string;
}

// ─── Environment & State ─────────────────────────────────────────────────────
export const MAX_FILE_SIZE = 1024 * 1024 * 10;

export const [state, setState] = createStore<Conversation>({
  status: 'loading',
  messages: [],
  tools: [],
  subagents: {},
  pendingApprovals: []
});

// ─── Stream Lifecycle Guard ──────────────────────────────────────────────────
let _streamVersion = 0;
let _activeAbortController: AbortController | null = null;

/** Invalidate any running stream. Called on conversation switch. */
function invalidateStream(): void {
  _streamVersion++;
  if (_activeAbortController) {
    _activeAbortController.abort();
    _activeAbortController = null;
  }
}

/** Check if the stream that started at `version` is still the active one. */
function isStreamAlive(version: number): boolean {
  return version === _streamVersion;
}

export async function loadConversation(): Promise<void> {
  const id = runId()
  if (!id) throw new Error('runId not provided')
  const { data, error } = await api.history({ runid: id }).get()
  if (error) {
    setState({ status: 'idle' })
    throw error
  }
  if (data == null) {
    setState({ status: 'idle' })
    throw new Error(`Failed to load history for runId "${id}": API returned no data`)
  }
  setState({ messages: data, status: 'idle' })
}

export function clearConversation(): void {
  invalidateStream();
  setState({
    status: 'loading',
    messages: [],
    tools: [],
    subagents: {},
    pendingApprovals: [],
    error: undefined
  })
}

// ─── Message Operations ──────────────────────────────────────────────────────
export function addMessage(message: ChatCompletionMessageParam): void {
  setState('messages', msgs => [...msgs, message]);
}

export function updateLastMessageContent(chunk: string): void {
  setState(produce(conv => {
    const lastIdx = conv.messages.length - 1;
    if (lastIdx < 0) return;
    const lastMsg = conv.messages[lastIdx];
    lastMsg.content += chunk;
  }));
}

export async function callstreamandhandleevents(message: string) {
  setState({ status: 'running', error: undefined })

  const messagetosend: ChatCompletionMessageParam = {
    content: message,
    role: "user"
  };

  addMessage(messagetosend)

  const id = runId()
  if (!id) throw new Error('runId not provided')

  const { data: uploadData, error: uploadError } = await api.file.upload.post({
    runId: id,
    files: attachments().map(a => a.file)
  })

  if (uploadError) {
    console.error('Upload failed', uploadError);
    setState({ status: 'idle' });
    return;
  }

  const agent = selectedAgent()
  if (!agent) throw new Error('agent not selected')

  // Register this stream and create abort controller
  invalidateStream();
  const myVersion = _streamVersion;
  const abortController = new AbortController();
  _activeAbortController = abortController;

  const { data, error } = await api.chat.post({
    message: messagetosend,
    runId: id,
    threadId: 'frontend-dev-1',
    agentId: agent,
    attachmentIds: uploadData.map(file => file.id)
  }, { signal: abortController.signal });

  if (error) {
    console.error('Chat post failed', error);
    setState({ status: 'idle' });
    _activeAbortController = null;
    return;
  }

  addMessage({ role: 'assistant', content: '' })

  let mainAgentId: string | null = null;

  try {
    for await (const chunk of data) {
      // If conversation changed, stop processing
      if (!isStreamAlive(myVersion)) break;

      if (!chunk.data) { console.log('No data chunk: \n', chunk); continue; }
      switch (chunk.data.type) {
        case "TEXT_MESSAGE_CHUNK": {
          if (!chunk.data.delta) break;
          const chunkAgentId = chunk.data.AgentId as string;

          if (mainAgentId === null) {
            mainAgentId = chunkAgentId;
            console.log('[chat.store] main agent detected:', mainAgentId);
          }

          if (chunkAgentId === mainAgentId) {
            updateLastMessageContent(chunk.data.delta as string);
          } else {
            setState(produce(conv => {
              const delta = chunk.data.delta as string;
              if (!conv.subagents[chunkAgentId]) {
                conv.subagents[chunkAgentId] = [{ role: 'assistant', content: delta }];
              } else {
                const msgs = conv.subagents[chunkAgentId];
                const last = msgs[msgs.length - 1];
                if (last?.role === 'assistant') {
                  (last.content as string) += delta;
                } else {
                  msgs.push({ role: 'assistant', content: delta });
                }
              }
            }));
          }
          break;
        }
        case "TOOL_CALL_START":
          setState('tools', tools => [
            ...tools,
            {
              id: chunk.data.toolCallId as string,
              name: chunk.data.toolCallName as string,
              args: ''
            }
          ]);
          break;
        case "TOOL_CALL_ARGS":
          setState(
            'tools',
            t => t.id === (chunk.data.toolCallId as string),
            'args',
            (a: string | undefined) => (a ?? '') + ((chunk.data.delta as string) ?? '')
          );
          break;
        case "TOOL_CALL_END":
          break;
        case "TOOL_CALL_RESULT":
          setState(
            'tools',
            t => t.id === (chunk.data.toolCallId as string),
            'result',
            chunk.data.content as string
          );
          break;
        case "CUSTOM": {
          if (chunk.data.name === "AWAITING_APPROVAL" && chunk.data.data?.pending_approvals) {
            setState({
              status: 'awaiting_approval',
              pendingApprovals: chunk.data.data.pending_approvals
            });
          }
          break;
        }
        case "RUN_ERROR": {
          const errMsg = chunk.data.message || 'An error occurred during the agent run';
          setState({ error: errMsg });
          break;
        }
        default:
          break;
      }
    }
  } catch (err) {
    // Aborted streams are expected on conversation switch -- not an error
    if (abortController.signal.aborted) {
      console.log('[chat.store] Stream aborted due to conversation switch');
    } else {
      console.error('[chat.store] Stream error:', err);
      if (isStreamAlive(myVersion)) {
        setState({ error: String(err) });
      }
    }
  } finally {
    if (_activeAbortController === abortController) {
      _activeAbortController = null;
    }
    if (isStreamAlive(myVersion) && state.status !== 'awaiting_approval') {
      setState({ status: 'idle' });
    }
    revalidate('runIds');
  }
}

export async function resumeWithDecision(decisions: Record<string, { approved: boolean; feedback?: string }>) {
  setState({ status: 'running' });

  const id = runId();
  if (!id) throw new Error('runId not provided');

  const agent = selectedAgent();
  if (!agent) throw new Error('agent not selected');

  setState({ pendingApprovals: [], error: undefined });

  // Register this stream
  invalidateStream();
  const myVersion = _streamVersion;
  const abortController = new AbortController();
  _activeAbortController = abortController;

  const { data, error } = await api.chat.post({
    message: { role: "user", content: "" },
    runId: id,
    threadId: 'frontend-dev-1',
    agentId: agent,
    decision: decisions,
  }, { signal: abortController.signal });

  if (error) {
    console.error('Resume failed', error);
    setState({ status: 'idle' });
    _activeAbortController = null;
    return;
  }

  try {
    for await (const chunk of data) {
      if (!isStreamAlive(myVersion)) break;
      if (!chunk.data) continue;
      switch (chunk.data.type) {
        case "TEXT_MESSAGE_CHUNK": {
          if (!chunk.data.delta) break;
          updateLastMessageContent(chunk.data.delta as string);
          break;
        }
        case "TOOL_CALL_START":
          setState('tools', tools => [...tools, { id: chunk.data.toolCallId as string, name: chunk.data.toolCallName as string, args: '' }]);
          break;
        case "TOOL_CALL_ARGS":
          setState('tools', t => t.id === (chunk.data.toolCallId as string), 'args', (a: string | undefined) => (a ?? '') + ((chunk.data.delta as string) ?? ''));
          break;
        case "TOOL_CALL_END":
          break;
        case "TOOL_CALL_RESULT":
          setState('tools', t => t.id === (chunk.data.toolCallId as string), 'result', chunk.data.content as string);
          break;
        case "CUSTOM": {
          if (chunk.data.name === "AWAITING_APPROVAL" && chunk.data.data?.pending_approvals) {
            setState({
              status: 'awaiting_approval',
              pendingApprovals: chunk.data.data.pending_approvals
            });
          }
          break;
        }
        case "RUN_ERROR": {
          const errMsg = chunk.data.message || 'An error occurred during the agent run';
          setState({ error: errMsg });
          break;
        }
        default:
          break;
      }
    }
  } catch (err) {
    if (abortController.signal.aborted) {
      console.log('[chat.store] Resume stream aborted due to conversation switch');
    } else {
      console.error('[chat.store] Resume stream error:', err);
      if (isStreamAlive(myVersion)) {
        setState({ error: String(err) });
      }
    }
  } finally {
    if (_activeAbortController === abortController) {
      _activeAbortController = null;
    }
    if (isStreamAlive(myVersion) && state.status !== 'awaiting_approval') {
      setState({ status: 'idle' });
    }
    revalidate('runIds');
  }
}
