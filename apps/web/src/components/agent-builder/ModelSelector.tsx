import { type Component, createSignal, Show, For } from "solid-js";
import { selectedAgent, models, updateAgentField } from "../../stores/agent-builder.store";

const ModelSelector: Component = () => {
  const [open, setOpen] = createSignal(false);

  const currentModel = () => {
    const m = selectedAgent()?.model;
    if (!m) return null;
    return models()[m];
  };

  const select = (name: string) => {
    updateAgentField({ model: name });
    setOpen(false);
  };

  return (
    <div class="relative">
      <button
        onClick={() => setOpen(!open())}
        class="w-full text-left px-3 py-1.5 bg-base-200 border border-base-content/10 text-sm font-mono flex items-center justify-between hover:border-primary/50 transition-colors"
      >
        <Show
          when={currentModel()}
          fallback={<span class="text-base-content/30">SELECT_MODEL</span>}
        >
          {(m) => (
            <span>
              {m().model}{" "}
              <span class="text-base-content/40 text-xs ml-1">({m().provider})</span>
            </span>
          )}
        </Show>
        <span class="material-symbols-outlined" style={{ "font-size": "16px" }}>
          {open() ? "expand_less" : "expand_more"}
        </span>
      </button>
      <Show when={open()}>
        <div class="absolute z-40 left-0 right-0 mt-1 bg-base-200 border border-base-content/10 shadow-lg max-h-48 overflow-y-auto">
          <For each={Object.entries(models())}>
            {([name, config]) => (
              <button
                onClick={() => select(name)}
                class={`w-full text-left px-3 py-2 text-sm font-mono hover:bg-primary/10 transition-colors ${
                  selectedAgent()?.model === name
                    ? "text-primary bg-primary/5"
                    : "text-base-content"
                }`}
              >
                <div class="font-bold">{config.model}</div>
                <div class="text-[10px] text-base-content/40">{config.provider}</div>
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
};

export default ModelSelector;
