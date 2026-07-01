import { type Component, createSignal, Show, For } from "solid-js";
import { selectedAgent, otherAgents, updateAgentField } from "../../stores/agent-builder.store";
import PillTag from "./PillTag";

const SubAgentPicker: Component = () => {
  const [open, setOpen] = createSignal(false);

  const selectedSubs = () => selectedAgent()?.subAgents ?? [];

  const availableAgents = () =>
    otherAgents().filter((a) => !selectedSubs().includes(a.agentId));

  const addSub = (id: string) => {
    const next = [...selectedSubs(), id];
    updateAgentField({ subAgents: next });
    setOpen(false);
  };

  const removeSub = (id: string) => {
    updateAgentField({ subAgents: selectedSubs().filter((s) => s !== id) });
  };

  return (
    <div>
      <div class="flex flex-wrap items-center gap-1.5 min-h-[28px]">
        <Show when={selectedSubs().length === 0}>
          <span class="text-xs text-base-content/30">NO_PARTY_MEMBERS</span>
        </Show>
        <For each={selectedSubs()}>
          {(id) => (
            <PillTag
              name={id}
              onRemove={() => removeSub(id)}
              color="bg-secondary/10 text-secondary border border-secondary/30"
            />
          )}
        </For>
        <button
          onClick={() => setOpen(!open())}
          class="btn btn-xs btn-ghost border border-base-content/10 text-base-content/50 hover:text-primary hover:border-primary/50"
        >
          <span class="material-symbols-outlined" style={{ "font-size": "14px" }}>add</span>
        </button>
      </div>
      <Show when={open()}>
        <div class="mt-1 bg-base-200 border border-base-content/10 shadow-lg max-h-40 overflow-y-auto">
          <For each={availableAgents()}>
            {(agent) => (
              <button
                onClick={() => addSub(agent.agentId)}
                class="w-full text-left px-3 py-1.5 text-xs font-mono hover:bg-primary/10 transition-colors text-base-content"
              >
                {agent.agentId}
              </button>
            )}
          </For>
          <Show when={availableAgents().length === 0}>
            <div class="px-3 py-2 text-xs text-base-content/30">NO_AVAILABLE_AGENTS</div>
          </Show>
        </div>
      </Show>
    </div>
  );
};

export default SubAgentPicker;
