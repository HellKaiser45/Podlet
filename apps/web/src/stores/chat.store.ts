import { createStore, produce } from "solid-js/store";
import type { ChatCompletionMessageParam } from "@podlet/types";

import { api } from "../utils/api/share.api";

import { createSignal } from "solid-js";
import { attachments } from "./attachements.store";
import { selectedAgent } from "./chatInput.store";
import { revalidate } from "@solidjs/router";

export const [runId, setRunId] = createSignal();
export const [label, setLabel] = createSignal("");

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
  status: 'idle' | 'running' | 'loading' | 'awaiting_approval';
  messages: ChatCompletionMessageParam[];
  tools: ToolCall[];
  subagents: Record;
  pendingApprovals: PendingApproval[];
}

// ─── Environment & State ─────────────────────────────────────────────────────
export const MAX_FILE_SIZE = 1024 * 1024 * 10;

export const [state, setState] = createStore({
  status: 'loading',
  messages: [],
  tools: [],
  subagents: {},
  pendingApprovals: []
});

let _streamVersion = 0;
let _activeAbortController: AbortController | null = null;

function invalidateStream() {
  _streamVersion++;
  if (_activeAbortController) {
    _activeAbortController.abort();
    _activeAbortController = null;
  }
}

function isStreamAlive(version: number) {
  return version === _streamVersion;
}

export async function loadConversation() {
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

export function clearConversation() {
  invalidateStream();
  setState({
    status: 'loading',
    messages: [],
    tools: [],
    subagents: {},
    pendingApprovals: [],
  })
}

// ─── Message Operations ──────────────────────────────────────────────────────
export function addMessage(message: ChatCompletionMessageParam) {
  setState('messages', msgs => [...msgs, message]);
}

export function updateLastMessageContent(chunk: string) {
  setState(produce(conv => {
    const lastIdx = conv.messages.length - 1;
    if (lastIdx >= 0) {
      const lastMsg = conv.messages[lastIdx];
      if (typeof lastMsg.content === 'string') {
        lastMsg.content += chunk;
      }
    }
  }));
}

function buildMessageWithAttachments(textMessage: string): ChatCompletionMessageParam {
  const fileAttachments = attachments();
  if (fileAttachments.length === 0) {
    return { role: 'user', content: textMessage };
  }

  const parts: any[] = [{ type: 'text', text: textMessage }];
  for (const att of fileAttachments) {
    if (att.file.type.startsWith('image/') && att.file instanceof File) {
      parts.push({
        type: 'image_url',
        image_url: { url: URL.createObjectURL(att.file) },
      });
    }
  }

  return { role: 'user', content: parts };
}

export function callstreamandhandleevents(message: string) {
  setState({ status: 'running' })

  const id = runId()
  if (!id) throw new Error('runId not provided')

  const agent = selectedAgent()
  if (!agent) throw new Error('agent not selected')

  // Build rich message with image blocks (object URLs) for immediate display
  const messagetosend = buildMessageWithAttachments(message);
  addMessage(messagetosend)

  const fileAttachments = attachments();

  // Upload files to backend (backend reconstructs base64 for the LLM)
  api.file.upload({ runId: id })
    .post({ files: fileAttachments.map(a => a.file) })
    .then(({ data: uploadData, error: uploadError }) => {
      if (uploadError) {
        console.error('Upload failed', uploadError);
        setState({ status: 'idle' });
        return;
      }

      // Register this stream and create abort controller
      invalidateStream();
      const myVersion = _streamVersion;
      const abortController = new AbortController();
      _activeAbortController = abortController;

      api.chat.post({
        message: { role: 'user', content: message },
        runId: id,
        threadId: 'frontend-dev-1',
        agentId: agent,
        attachmentIds: uploadData.map(file => file.id)
      }, { signal: abortController.signal }).then(({ data, error }) => {
        if (error) {
          console.error('Chat post failed', error);
          setState({ status: 'idle' });
          if (_activeAbortController === abortController) {
            _activeAbortController = null;
          }
          return;
        }

        addMessage({ role: 'assistant', content: '' })

        let mainAgentId: string | null = null;

        (async () => {
          try {
            for await (const chunk of data) {
              if (!isStreamAlive(myVersion)) break;

              if (!chunk.data) { console.log('No data chunk: \n', chunk); continue; }
              switch (chunk.data.type) {
                case "TEXT_MESSAGE_CHUNK": {
                  if (!chunk.data.delta) break;
                  const chunkAgentId = chunk.data.AgentId;

                  if (mainAgentId === null) {
                    mainAgentId = chunkAgentId;
                    console.log('[chat.store] main agent detected:', mainAgentId);
                  }

                  if (chunkAgentId === mainAgentId) {
                    updateLastMessageContent(chunk.data.delta);
                  } else {
                    setState(produce(conv => {
                      const delta = chunk.data.delta;
                      if (!conv.subagents[chunkAgentId]) {
                        conv.subagents[chunkAgentId] = [{ role: 'assistant', content: delta }];
                      } else {
                        const msgs = conv.subagents[chunkAgentId];
                        const last = msgs[msgs.length - 1];
                        if (last?.role === 'assistant') {
                          last.content = (last.content ?? '') + delta;
                        } else {
                          msgs.push({ role: 'assistant', content: delta });
                        }
                      }
                    }));
                  }
                  break;
                }
                case "TOOL_CALL_START":
                  setState('tools', tools => [...tools, {
                    id: chunk.data.toolCallId,
                    name: chunk.data.toolCallName,
                    args: ''
                  }]);
                  break;
                case "TOOL_CALL_ARGS":
                  setState('tools', t => t.id === chunk.data.toolCallId, 'args',
                    (a) => (a ?? '') + (chunk.data.delta ?? ''));
                  break;
                case "TOOL_CALL_END":
                  break;
                case "TOOL_CALL_RESULT":
                  setState('tools', t => t.id === chunk.data.toolCallId, 'result',
                    chunk.data.content);
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
        })();
      });
    });
}

export function resumeWithDecision(decisions: Record) {
  setState({ status: 'running' });

  const id = runId();
  if (!id) throw new Error('runId not provided');

  const agent = selectedAgent();
  if (!agent) throw new Error('agent not selected');

  setState({ pendingApprovals: [] });

  invalidateStream();
  const myVersion = _streamVersion;
  const abortController = new AbortController();
  _activeAbortController = abortController;

  api.chat.post({
    message: { role: "user", content: "" },
    runId: id,
    threadId: 'frontend-dev-1',
    agentId: agent,
    decision: decisions,
  }, { signal: abortController.signal }).then(({ data, error }) => {
    if (error) {
      console.error('Resume failed', error);
      setState({ status: 'idle' });
      _activeAbortController = null;
      return;
    }

    (async () => {
      try {
        for await (const chunk of data) {
          if (!isStreamAlive(myVersion)) break;
          if (!chunk.data) continue;
          switch (chunk.data.type) {
            case "TEXT_MESSAGE_CHUNK": {
              if (!chunk.data.delta) break;
              updateLastMessageContent(chunk.data.delta);
              break;
            }
            case "TOOL_CALL_START":
              setState('tools', tools => [...tools, { id: chunk.data.toolCallId, name: chunk.data.toolCallName, args: '' }]);
              break;
            case "TOOL_CALL_ARGS":
              setState('tools', t => t.id === chunk.data.toolCallId, 'args', (a) => (a ?? '') + (chunk.data.delta ?? ''));
              break;
            case "TOOL_CALL_END":
              break;
            case "TOOL_CALL_RESULT":
              setState('tools', t => t.id === chunk.data.toolCallId, 'result', chunk.data.content);
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
    })();
  });
}
