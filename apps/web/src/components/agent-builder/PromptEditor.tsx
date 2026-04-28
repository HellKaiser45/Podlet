import { type Component, createSignal, createEffect } from "solid-js";
import { selectedAgent, updateAgentField } from "../../stores/agent-builder.store";

const PromptEditor: Component = () => {
  const [text, setText] = createSignal("");

  createEffect(() => {
    const prompt = selectedAgent()?.system_prompt ?? "";
    setText(prompt);
  });

  let timer: ReturnType<typeof setTimeout> | null = null;

  const onBlur = () => {
    updateAgentField({ system_prompt: text() });
  };

  const onInput = (val: string) => {
    setText(val);
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      updateAgentField({ system_prompt: val });
    }, 800);
  };

  return (
    <div>
      <label class="text-[10px] font-bold uppercase tracking-widest text-primary mb-1 block">
        CORE_DIRECTIVES
      </label>
      <textarea
        class="textarea textarea-bordered w-full font-mono text-sm min-h-[120px] resize-none focus:textarea-primary bg-base-200"
        value={text()}
        onInput={(e) => onInput(e.currentTarget.value)}
        onBlur={onBlur}
        spellcheck={false}
      />
      <div class="text-[10px] text-base-content/30 mt-1">
        Directives are saved automatically
      </div>
    </div>
  );
};

export default PromptEditor;
