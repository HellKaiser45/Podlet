import { For, Show, createEffect, createSignal, on } from "solid-js";
import { useParams } from "@solidjs/router";
import { loadConversation, state } from "../stores/chat.store";
import ChatBubble from "./chat/chat-bubbles";
import { InputChatbox } from "./input-chatbox";
import { DataVault } from "./data-vault";

export default function ChatWriter() {
  const params = useParams<{ runId: string }>();
  const messages = () => state[params.runId]?.messages;
  const [vaultOpen, setVaultOpen] = createSignal(false);

  // Tracks file references injected from the vault so they appear in the
  // chat input as @mentions. The InputChatbox doesn't have an imperative API,
  // so we use a shared signal; wire it up however fits your design.
  const [injectedFile, setInjectedFile] = createSignal<{
    id: string;
    name: string;
  } | null>(null);

  loadConversation(params.runId);

  let scrollContainer: HTMLDivElement | undefined;

  createEffect(
    on(
      () => messages()?.length,
      () => {
        if (scrollContainer) {
          scrollContainer.scrollTop = scrollContainer.scrollHeight;
        }
      }
    )
  );

  const handleInject = (fileId: string, fileName: string) => {
    // Expose the injected file — InputChatbox (or a wrapper) can pick this up
    // via a shared signal / context, or you can thread it through props.
    setInjectedFile({ id: fileId, name: fileName });
    // Optionally close the vault after inject
    // setVaultOpen(false);
  };

  return (
    <div class="flex h-screen bg-base-100 overflow-hidden">
      {/* ── Main Chat Column ───────────────────────────────────────────────── */}
      <div class="flex flex-col flex-1 min-w-0">
        {/* Top bar */}
        <div class="shrink-0 flex items-center justify-between px-4 py-2 border-b border-base-300/50 bg-base-100 font-mono">
          {/* Run ID badge */}
          <div class="text-[9px] text-base-content/25 uppercase tracking-widest hidden sm:block">
            session://
            <span class="text-base-content/40">{params.runId}</span>
          </div>

          {/* Vault toggle */}
          <button
            onClick={() => setVaultOpen((v) => !v)}
            class={`btn btn-xs gap-1.5 font-mono uppercase tracking-widest transition-all ml-auto ${vaultOpen()
              ? "btn-primary shadow-[0_0_12px_oklch(var(--p)/.25)]"
              : "btn-ghost border border-base-content/15 text-base-content/40 hover:text-primary hover:border-primary/40"
              }`}
          >
            {/* Vault icon */}
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              stroke-width="2"
              stroke="currentColor"
              class="w-3 h-3"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 2.625c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125m16.5 5.625c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125"
              />
            </svg>
            Data_Vault
            <Show when={vaultOpen()}>
              <div class="w-1.5 h-1.5 bg-primary-content rounded-full animate-pulse shrink-0" />
            </Show>
          </button>
        </div>

        {/* Injected file toast */}
        <Show when={injectedFile()}>
          <div class="shrink-0 mx-4 mt-3">
            <div class="flex items-center justify-between gap-2 bg-primary/10 border border-primary/30 px-3 py-2 font-mono text-[10px] text-primary uppercase tracking-widest">
              <div class="flex items-center gap-2">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke-width="2"
                  stroke="currentColor"
                  class="w-3 h-3 shrink-0"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="m3.75 13.5 10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75Z"
                  />
                </svg>
                <span>
                  Injected:{" "}
                  <span class="opacity-70">{injectedFile()!.name.split("/").pop()}</span>
                </span>
              </div>
              <button
                class="opacity-50 hover:opacity-100 transition-opacity"
                onClick={() => setInjectedFile(null)}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke-width="2.5"
                  stroke="currentColor"
                  class="w-3 h-3"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M6 18 18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
          </div>
        </Show>

        {/* Messages */}
        <div
          ref={scrollContainer}
          class="flex-1 overflow-y-auto px-4 py-6 scroll-smooth"
        >
          <div class="max-w-3xl mx-auto space-y-4">
            <For each={messages()}>
              {(message) => <ChatBubble {...message} />}
            </For>
            <div class="h-4" />
          </div>
        </div>

        {/* Input */}
        <div class="shrink-0 p-4 pb-6">
          <div class="max-w-3xl mx-auto">
            <InputChatbox runid={params.runId} />
          </div>
        </div>
      </div>

      {/* ── Vault Panel ────────────────────────────────────────────────────── */}
      <Show when={vaultOpen()}>
        <div
          class="shrink-0 border-l border-base-300 overflow-hidden flex flex-col"
          style={{ width: "480px" }}
        >
          <DataVault
            runId={params.runId}
            onClose={() => setVaultOpen(false)}
            onInject={handleInject}
          />
        </div>
      </Show>
    </div>
  );
}
