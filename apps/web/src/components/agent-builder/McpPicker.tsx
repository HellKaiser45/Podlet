import { type Component, createSignal, Show, For } from "solid-js";
import { selectedAgent, mcps, updateAgentField } from "../../stores/agent-builder.store";
import PillTag from "./PillTag";

const McpPicker: Component = () => {
  const [open, setOpen] = createSignal(false);

  const selectedMcps = () => selectedAgent()?.mcps ?? [];

  const availableMcps = () =>
    Object.keys(mcps()).filter((k) => !selectedMcps().includes(k));

  const addMcp = (name: string) => {
    const next = [...selectedMcps(), name];
    updateAgentField({ mcps: next });
    setOpen(false);
  };

  const removeMcp = (name: string) => {
    updateAgentField({ mcps: selectedMcps().filter((m) => m !== name) });
  };

  return (
    <div>
      <div class="flex flex-wrap items-center gap-1.5 min-h-[28px]">
        <Show when={selectedMcps().length === 0}>
          <span class="text-xs text-base-content/30">NO_PROTOCOLS_LINKED</span>
        </Show>
        <For each={selectedMcps()}>
          {(name) => (
            <PillTag
              name={name}
              onRemove={() => removeMcp(name)}
              color="bg-accent/10 text-accent border border-accent/30"
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
          <For each={availableMcps()}>
            {(name) => (
              <button
                onClick={() => addMcp(name)}
                class="w-full text-left px-3 py-1.5 text-xs font-mono hover:bg-primary/10 transition-colors text-base-content"
              >
                {name}
              </button>
            )}
          </For>
          <Show when={availableMcps().length === 0}>
            <div class="px-3 py-2 text-xs text-base-content/30">NO_AVAILABLE_PROTOCOLS</div>
          </Show>
        </div>
      </Show>
    </div>
  );
};

export default McpPicker;
