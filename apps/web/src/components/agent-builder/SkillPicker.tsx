import { type Component, createSignal, Show, For } from "solid-js";
import { selectedAgent, skills, updateAgentField } from "../../stores/agent-builder.store";
import PillTag from "./PillTag";

const SkillPicker: Component = () => {
  const [open, setOpen] = createSignal(false);

  const selectedSkills = () => selectedAgent()?.skills ?? [];

  const availableSkills = () =>
    skills().filter((s) => !selectedSkills().includes(s.name));

  const addSkill = (name: string) => {
    const next = [...selectedSkills(), name];
    updateAgentField({ skills: next });
    setOpen(false);
  };

  const removeSkill = (name: string) => {
    updateAgentField({ skills: selectedSkills().filter((s) => s !== name) });
  };

  return (
    <div>
      <div class="flex flex-wrap items-center gap-1.5 min-h-[28px]">
        <Show when={selectedSkills().length === 0}>
          <span class="text-xs text-base-content/30">NO_SKILLS_EQUIPPED</span>
        </Show>
        <For each={selectedSkills()}>
          {(name) => <PillTag name={name} onRemove={() => removeSkill(name)} />}
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
          <For each={availableSkills()}>
            {(skill) => (
              <button
                onClick={() => addSkill(skill.name)}
                class="w-full text-left px-3 py-1.5 text-xs font-mono hover:bg-primary/10 transition-colors text-base-content"
              >
                {skill.name}
              </button>
            )}
          </For>
          <Show when={availableSkills().length === 0}>
            <div class="px-3 py-2 text-xs text-base-content/30">NO_AVAILABLE_SKILLS</div>
          </Show>
        </div>
      </Show>
    </div>
  );
};

export default SkillPicker;
