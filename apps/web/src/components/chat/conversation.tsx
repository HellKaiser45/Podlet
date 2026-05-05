import { ChatCompletionMessageParam } from "@podlet/types";
import { createSignal, For, Show } from "solid-js";
import ChatBubble from "./chat-bubbles";
import ActivityPanel from "./ActivityPanel";
import { state } from "../../stores/chat.store";

export default function Conversation(props: { messages: ChatCompletionMessageParam[] }) {
  return (
    <div class="flex flex-col gap-4">
      <For each={props.messages}>
        {(message) => <ChatBubble message={message} />}
      </For>
      <SubagentBlocks />
      <ActivityPanel />
    </div>
  );
}

export function SubagentBlocks() {
  const subagentIds = () => Object.keys(state.subagents);

  return (
    <Show when={subagentIds().length > 0}>
      <For each={subagentIds()}>
        {(agentId) => {
          const msgs = () => state.subagents[agentId];
          const lastContent = () => {
            const last = msgs()[msgs().length - 1];
            if (!last) return '';
            return typeof last.content === 'string' ? last.content : '';
          };
          const [open, setOpen] = createSignal(false);

          return (
            <div class="chat chat-start mb-2 w-full">
              <div class="chat-header opacity-60 text-sm mb-1">
                <span class="badge badge-info badge-xs">{agentId}</span>
              </div>
              <div class="chat-bubble chat-bubble-neutral p-3 max-w-[90%] border border-info/20 bg-info/5">
                <button
                  class="text-xs text-info/70 hover:text-info cursor-pointer w-full text-left"
                  onClick={() => setOpen(o => !o)}
                >
                  {open() ? '▼ Hide output' : `▶ ${lastContent().slice(0, 80)}${lastContent().length > 80 ? '...' : ''}`}
                </button>
                <Show when={open()}>
                  <div class="mt-2 text-sm prose prose-sm prose-invert max-w-none">
                    <For each={msgs()}>
                      {(msg) => <p>{typeof msg.content === 'string' ? msg.content : ''}</p>}
                    </For>
                  </div>
                </Show>
              </div>
            </div>
          );
        }}
      </For>
    </Show>
  );
}
