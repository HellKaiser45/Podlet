import { onMount, Show } from "solid-js";
import { loadAll, selectedAgentId, selectAgent } from "../stores/agent-builder.store";
import AgentList from "../components/agent-builder/AgentList";
import AgentDetail from "../components/agent-builder/AgentDetail";

export default function AgentBuilder() {
  onMount(() => {
    loadAll();
  });

  return (
    <div class="flex h-full min-h-0 overflow-hidden">
      {/* Left: Agent List */}
      <div
        class={`border-r border-base-content/10 flex flex-col bg-base-100 overflow-hidden
         ${selectedAgentId() ? "hidden md:flex" : "flex"}
         w-full md:w-4/12 lg:w-3/12`}
      >
        <AgentList />
      </div>

      {/* Right: Agent Detail */}
      <div
        class={`flex-1 flex-col overflow-hidden
         ${selectedAgentId() ? "flex" : "hidden md:flex"}`}
      >
        <Show when={selectedAgentId()}>
          <div class="md:hidden border-b border-base-content/10 px-3 py-2">
            <button
              class="btn btn-ghost btn-sm gap-1 text-xs uppercase tracking-wider text-base-content/50 hover:text-primary"
              onClick={() => selectAgent(null)}
            >
              <span class="material-symbols-outlined text-sm">arrow_back</span>
              BACK_TO_ROSTER
            </button>
          </div>
        </Show>
        <AgentDetail />
      </div>
    </div>
  );
}
