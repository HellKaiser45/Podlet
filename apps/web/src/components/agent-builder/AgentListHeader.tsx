import { type Component } from "solid-js";
import { agents } from "../../stores/agent-builder.store";

const AgentListHeader: Component = () => {
  return (
    <div class="flex justify-between items-center px-3 py-2 border-b border-base-content/10 bg-base-100/50">
      <span class="text-[10px] font-bold uppercase tracking-widest text-primary">
        AGENT_ROSTER
      </span>
      <div class="badge badge-ghost badge-xs font-bold">
        {Object.keys(agents()).length} UNITS
      </div>
    </div>
  );
};

export default AgentListHeader;
