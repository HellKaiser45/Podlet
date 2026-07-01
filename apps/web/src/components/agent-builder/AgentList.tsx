import { type Component, For, createMemo } from "solid-js";
import { agents, createNewAgent } from "../../stores/agent-builder.store";
import AgentListHeader from "./AgentListHeader";
import AgentRow from "./AgentRow";

const AgentList: Component = () => {
  const sortedEntries = createMemo(() =>
    Object.entries(agents()).sort(([a], [b]) => a.localeCompare(b))
  );

  return (
    <div class="flex flex-col h-full border border-base-content/10 bg-base-100">
      <AgentListHeader />

      <div class="px-3 py-1.5 border-b border-base-content/10">
        <button
          class="btn btn-xs w-full uppercase tracking-[0.15em] font-bold btn-ghost border border-dashed border-base-content/20 hover:border-primary hover:text-primary hover:bg-primary/5 transition-all gap-1"
          onClick={() => createNewAgent()}
        >
          <span class="material-symbols-outlined text-sm">add</span>
          NEW_AGENT
        </button>
      </div>

      <div class="flex-1 overflow-y-auto">
        <For each={sortedEntries()}>
          {([agentId, agent]) => <AgentRow agentId={agentId} agent={agent} />}
        </For>
      </div>
    </div>
  );
};

export default AgentList;
