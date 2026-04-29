import { useParams } from "@solidjs/router";
import { clearConversation, loadConversation, setRunId, state, setState } from "../../stores/chat.store";
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

        <Show when={state.error}>
          <div class="shrink-0 w-full px-4 py-2 bg-error/10 border-b border-error/30">
            <div class="max-w-3xl mx-auto flex items-start gap-3">
              <svg xmlns="http://www.w3.org/2000/svg" class="size-5 text-error shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
              </svg>
              <div class="flex-1">
                <p class="text-sm text-error">{state.error}</p>
              </div>
              <button
                class="btn btn-ghost btn-xs text-error"
                onClick={() => setState({ error: undefined })}
              >
                DISMISS
              </button>
            </div>
          </div>
        </Show>

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
