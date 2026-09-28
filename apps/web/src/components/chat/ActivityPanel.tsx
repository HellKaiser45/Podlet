import { createSignal, For, Show } from "solid-js";
import { state } from "../../stores/chat.store";
import type { ToolCall } from "../../stores/chat.store";
import type { ChatCompletionMessageParam } from "@podlet/types";

// ─── Tool Call Row ────────────────────────────────────────────────────────────

function ToolRow(props: { tool: ToolCall }) {
  const [open, setOpen] = createSignal(false);
  const isDone = () => props.tool.result !== undefined;

  const prettyArgs = () => {
    try { return JSON.stringify(JSON.parse(props.tool.args ?? ''), null, 2); }
    catch { return props.tool.args ?? ''; }
  };

  const prettyResult = () => {
    try { return JSON.stringify(JSON.parse(props.tool.result ?? ''), null, 2); }
    catch { return props.tool.result ?? ''; }
  };

  return (
    <div class="rounded-lg border border-base-300 text-sm overflow-hidden">
      <button
        class="w-full flex items-center gap-2 px-3 py-2 hover:bg-base-300/40 transition-colors text-left"
        onClick={() => setOpen(o => !o)}
      >
        {/* status dot */}
        <span
          class={`size-2 rounded-full shrink-0 ${isDone()
            ? 'bg-success'
            : 'bg-warning animate-pulse'
            }`}
        />
        <span class="text-xs font-mono text-base-content/50">fn</span>
        <span class="font-semibold font-mono">{props.tool.name}</span>
        <Show when={!isDone()}>
          <span class="loading loading-dots loading-xs ml-1 text-base-content/40" />
        </Show>
        <span class="ml-auto text-base-content/30 text-xs">{open() ? '▲' : '▼'}</span>
      </button>

      <Show when={open()}>
        <div class="border-t border-base-300 divide-y divide-base-300">
          <Show when={props.tool.args}>
            <div class="px-3 py-2">
              <p class="text-xs text-base-content/40 mb-1">args</p>
              <pre class="text-xs font-mono bg-base-300/50 p-2 rounded overflow-x-auto whitespace-pre-wrap">
                {prettyArgs()}
              </pre>
            </div>
          </Show>
          <Show when={props.tool.result}>
            <div class="px-3 py-2">
              <p class="text-xs text-base-content/40 mb-1">result</p>
              <pre class="text-xs font-mono bg-base-300/50 p-2 rounded overflow-x-auto max-h-40 whitespace-pre-wrap">
                {prettyResult()}
              </pre>
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
}

// ─── Subagent Section ─────────────────────────────────────────────────────────

function SubagentRow(props: { agentId: string; messages: ChatCompletionMessageParam[] }) {
  const [open, setOpen] = createSignal(false);
  const isActive = () => state.status === 'running';
  const lastMsg = () => {
    const last = props.messages[props.messages.length - 1];
    if (!last) return '';
    return typeof last.content === 'string' ? last.content : '';
  };

  return (
    <div class="rounded-lg border border-base-300 text-sm overflow-hidden">
      <button
        class="w-full flex items-center gap-2 px-3 py-2 hover:bg-base-300/40 transition-colors text-left"
        onClick={() => setOpen(o => !o)}
      >
        <span
          class={`size-2 rounded-full shrink-0 ${isActive() ? 'bg-info animate-pulse' : 'bg-info'
            }`}
        />
        <span class="text-xs font-mono text-base-content/50">agent</span>
        <span class="font-semibold truncate max-w-[12rem]">{props.agentId}</span>
        <Show when={!open()}>
          <span class="text-xs text-base-content/40 truncate flex-1 ml-1">
            {lastMsg().slice(0, 60)}{lastMsg().length > 60 ? '…' : ''}
          </span>
        </Show>
        <span class="ml-auto shrink-0 text-base-content/30 text-xs">{open() ? '▲' : '▼'}</span>
      </button>

      <Show when={open()}>
        <div class="border-t border-base-300 px-3 py-2 space-y-2 max-h-48 overflow-y-auto">
          <For each={props.messages}>
            {(msg) => (
              <p class="text-xs text-base-content/70 leading-relaxed">
                {typeof msg.content === 'string' ? msg.content : ''}
              </p>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

// ─── Panel ────────────────────────────────────────────────────────────────────

export default function ActivityPanel() {
  const [open, setOpen] = createSignal(true);

  const toolCount = () => state.tools.length;
  const subagentIds = () => Object.keys(state.subagents);
  const hasActivity = () => toolCount() > 0 || subagentIds().length > 0;
  const pendingTools = () => state.tools.filter(t => t.result === undefined).length;

  return (
    <Show when={hasActivity()}>
      <div class="rounded-xl border border-base-300 bg-base-200/60 overflow-hidden text-sm">
        {/* Header */}
        <button
          class="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-base-300/40 transition-colors"
          onClick={() => setOpen(o => !o)}
        >
          <Show
            when={state.status === 'running'}
            fallback={<span class="text-base">⚡</span>}
          >
            <span class="loading loading-spinner loading-xs text-base-content/60" />
          </Show>
          <span class="font-medium text-base-content/80">Agent Activity</span>

          {/* live badges */}
          <Show when={pendingTools() > 0}>
            <span class="badge badge-warning badge-xs gap-1">
              {pendingTools()} running
            </span>
          </Show>
          <Show when={subagentIds().length > 0}>
            <span class="badge badge-info badge-xs">
              {subagentIds().length} subagent{subagentIds().length > 1 ? 's' : ''}
            </span>
          </Show>

          <span class="ml-auto text-base-content/30 text-xs">{open() ? '▲' : '▼'}</span>
        </button>

        {/* Body */}
        <Show when={open()}>
          <div class="px-3 pb-3 space-y-1.5 border-t border-base-300">
            {/* tools */}
            <Show when={toolCount() > 0}>
              <p class="text-xs text-base-content/40 pt-2 pb-1 uppercase tracking-wide">Tools</p>
              <For each={state.tools}>
                {(tool) => <ToolRow tool={tool} />}
              </For>
            </Show>

            {/* subagents */}
            <Show when={subagentIds().length > 0}>
              <p class="text-xs text-base-content/40 pt-2 pb-1 uppercase tracking-wide">Subagents</p>
              <For each={subagentIds()}>
                {(id) => (
                  <SubagentRow agentId={id} messages={state.subagents[id]} />
                )}
              </For>
            </Show>
          </div>
        </Show>
      </div>
    </Show>
  );
}
