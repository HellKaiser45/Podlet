import { type Component, For } from "solid-js";
import {
  selectedAgent,
  updateAgentField,
  type AgentThinking,
} from "../../stores/agent-builder.store";

const LEVELS: { id: AgentThinking; label: string }[] = [
  { id: "none", label: "NONE" },
  { id: "low", label: "LOW" },
  { id: "medium", label: "MEDIUM" },
  { id: "high", label: "HIGH" },
];

const ThinkingSelector: Component = () => {
  const current = () => selectedAgent()?.thinking ?? "none";

  const select = (level: AgentThinking) => {
    updateAgentField({ thinking: level });
  };

  return (
    <div>
      <div class="flex w-full bg-base-200 border border-base-content/10">
        <For each={LEVELS}>
          {(level) => (
            <button
              type="button"
              aria-pressed={current() === level.id}
              onClick={() => select(level.id)}
              class={`flex-1 px-3 py-1.5 text-sm font-mono uppercase transition-colors border-r border-base-content/10 last:border-r-0 ${
                current() === level.id
                  ? "text-primary bg-primary/5"
                  : "text-base-content hover:bg-primary/10"
              }`}
            >
              {level.label}
            </button>
          )}
        </For>
      </div>
      <div class="mt-1 text-[10px] text-base-content/40">
        Positional: lowest / middle / highest of the model's own scale.
      </div>
    </div>
  );
};

export default ThinkingSelector;