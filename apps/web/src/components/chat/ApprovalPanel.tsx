import { createSignal, For, Show } from "solid-js";
import { state, resumeWithDecision } from "../../stores/chat.store";
import type { PendingApproval } from "../../stores/chat.store";

export default function ApprovalPanel() {
  const [decisions, setDecisions] = createSignal<Record<string, { approved: boolean; feedback?: string }>>({});
  const [rejectingIds, setRejectingIds] = createSignal<Set<string>>(new Set());
  const [feedbackTexts, setFeedbackTexts] = createSignal<Record<string, string>>({});

  const pending = () => state.pendingApprovals;

  function approve(id: string) {
    setDecisions(prev => ({ ...prev, [id]: { approved: true } }));
    setRejectingIds(prev => { const s = new Set(prev); s.delete(id); return s; });
  }

  function reject(id: string) {
    setRejectingIds(prev => { const s = new Set(prev); s.add(id); return s; });
  }

  function submitAll() {
    const finalDecisions: Record<string, { approved: boolean; feedback?: string }> = {};
    for (const pa of pending()) {
      const id = pa.tool_call.id;
      if (decisions()[id]) {
        finalDecisions[id] = decisions()[id];
      } else {
        finalDecisions[id] = { approved: false, feedback: "No decision made" };
      }
    }
    resumeWithDecision(finalDecisions);
  }

  const allDecided = () => {
    const p = pending();
    if (p.length === 0) return false;
    return p.every(pa => decisions()[pa.tool_call.id] !== undefined);
  };

  return (
    <div class="rounded-xl border-2 border-warning/50 bg-warning/5 p-4 space-y-3">
      <div class="flex items-center gap-2 text-warning">
        <span class="loading loading-ring loading-sm"></span>
        <span class="font-bold text-sm uppercase tracking-wider">Agent Paused -- Awaiting Approval</span>
      </div>

      <div class="space-y-2">
        <For each={pending()}>
          {(pa: PendingApproval) => {
            const id = () => pa.tool_call.id;
            const decided = () => decisions()[id()] !== undefined;
            const isRejected = () => rejectingIds().has(id());

            const prettyArgs = () => {
              try { return JSON.stringify(JSON.parse(pa.tool_call.function.arguments), null, 2); }
              catch { return pa.tool_call.function.arguments; }
            };

            return (
              <div class={`rounded-lg border ${decided() ? 'border-base-300/50 opacity-60' : 'border-warning/30'} bg-base-200 p-3`}>
                <div class="flex items-center gap-2 mb-2">
                  <span class="badge badge-warning badge-sm font-mono">fn</span>
                  <span class="font-semibold font-mono text-sm">{pa.tool_call.function.name}</span>
                  <Show when={decided()}>
                    <span class={`badge badge-xs ${decisions()[id()]?.approved ? 'badge-success' : 'badge-error'}`}>
                      {decisions()[id()]?.approved ? 'APPROVED' : 'REJECTED'}
                    </span>
                  </Show>
                </div>

                <pre class="text-xs font-mono bg-base-300/50 p-2 rounded overflow-x-auto whitespace-pre-wrap max-h-32 mb-2">
                  {prettyArgs()}
                </pre>

                <Show when={pa.description}>
                  <p class="text-xs text-base-content/50 mb-2">{pa.description}</p>
                </Show>

                <Show when={!decided()}>
                  <div class="flex gap-2">
                    <button class="btn btn-primary btn-xs" onClick={() => approve(id())}>APPROVE</button>
                    <button class="btn btn-error btn-xs" onClick={() => reject(id())}>REJECT</button>
                  </div>
                </Show>

                <Show when={isRejected() && !decided()}>
                  <div class="mt-2 space-y-2">
                    <textarea
                      class="textarea textarea-bordered textarea-xs w-full text-xs bg-base-100"
                      placeholder="Why are you rejecting this? (optional)"
                      value={feedbackTexts()[id()] ?? ''}
                      onInput={(e) => setFeedbackTexts(prev => ({ ...prev, [id()]: e.currentTarget.value }))}
                    />
                    <button
                      class="btn btn-error btn-xs"
                      onClick={() => {
                        setDecisions(prev => ({ ...prev, [id()]: { approved: false, feedback: feedbackTexts()[id()] || undefined } }));
                        setRejectingIds(prev => { const s = new Set(prev); s.delete(id()); return s; });
                      }}
                    >
                      CONFIRM REJECT
                    </button>
                  </div>
                </Show>
              </div>
            );
          }}
        </For>
      </div>

      <div class="flex items-center gap-3 pt-2 border-t border-warning/20">
        <button
          class="btn btn-warning btn-sm"
          onClick={submitAll}
          disabled={!allDecided()}
        >
          SUBMIT DECISIONS ({Object.keys(decisions()).length}/{pending().length})
        </button>
        <Show when={!allDecided() && pending().length > 0}>
          <span class="text-xs text-base-content/40">
            Decide on all tools to continue
          </span>
        </Show>
      </div>
    </div>
  );
}
