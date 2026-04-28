import { type Component } from "solid-js";

const EmptyDetailState: Component = () => (
  <div class="flex flex-col items-center justify-center h-full min-h-[400px] gap-4">
    <span class="material-symbols-outlined text-5xl text-base-content/20">smart_toy</span>
    <span class="text-xs font-bold uppercase text-base-content/30">
      SELECT_AGENT_FROM_ROSTER
    </span>
  </div>
);

export default EmptyDetailState;
