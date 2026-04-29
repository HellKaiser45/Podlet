import { useParams } from "@solidjs/router";
import { clearConversation, loadConversation, setRunId, state } from "../../stores/chat.store";
import ChatInputs from "./chatBox/chatInputs";
import Conversation from "./conversation";
import { createEffect, Show } from "solid-js";
import IconWrapper from "../ui/iconWrapper";
import MiniPodletIcon from "../ui/icons/miniPodlet";
import ApprovalPanel from "./ApprovalPanel";



export default function Chat() {
  const params = useParams();
  let scrollRef: HTMLDivElement | undefined;

  createEffect(async () => {
    const currentId = params.runid;
    if (currentId) {
      clearConversation();
      setRunId(currentId);
      await loadConversation();
    }
  });

  createEffect(() => {
    const msgs = state.messages;
    const len = msgs.length;
    if (len === 0 || !scrollRef) return;

    const lastContent = msgs[len - 1].content;

    setTimeout(() => {
      scrollRef!.scrollTop = scrollRef!.scrollHeight;
    }, 0);
  });

  return (
    <div class="flex-1 flex flex-col min-h-0 w-full bg-base-100 relative overflow-hidden">
      <Show when={state.status !== 'loading'} fallback={<div>Loading...</div>}>

        <Show when={state.messages.length === 0}>
          <div class="flex-1 flex flex-col items-center justify-center gap-6 p-8">
            <div class="flex flex-col items-center gap-3">
              <IconWrapper class="size-96">
                <MiniPodletIcon />
              </IconWrapper>
              <h1 class="text-2xl font-semibold text-base-content">How can I help you?</h1>
              <p class="text-base-content/50 text-sm">Start a conversation below</p>
            </div>
            <div class="w-full max-w-3xl">
              <ChatInputs />
            </div>
          </div>
        </Show>

        <Show when={state.messages.length > 0}>
          <div class="flex-1 flex flex-col min-h-0 relative">
            <div class="flex-1 relative min-h-0">
              <div
                ref={el => scrollRef = el}
                class="absolute inset-0 overflow-y-auto overflow-x-hidden p-4 space-y-4"
              >
                <div class="w-full max-w-3xl mx-auto">
                  <Conversation messages={state.messages} />
                </div>
              </div>
            </div>

            <Show when={state.status === 'awaiting_approval'}>
              <div class="shrink-0 w-full px-4 pt-2">
                <div class="max-w-3xl mx-auto">
                  <ApprovalPanel />
                </div>
              </div>
            </Show>

            <Show when={state.status !== 'awaiting_approval'}>
              <div class="shrink-0 w-full p-4 border-t border-base-content/10 bg-base-100 z-10">
                <div class="max-w-3xl mx-auto flex justify-center">
                  <ChatInputs />
                </div>
              </div>
            </Show>
          </div>
        </Show>

      </Show>
    </div>
  );
}
