import { type Component, createMemo } from "solid-js";
import {
  models,
  selectedAgentId,
  selectAgent,
} from "../../stores/agent-builder.store";
import type { Agent } from "../../stores/agent-builder.store";

interface AgentRowProps {
  agentId: string;
  agent: Agent;
}

const providerColor: Record<string, string> = {
  openai: "text-primary",
  anthropic: "text-secondary",
  openrouter: "text-accent",
  ollama: "text-info",
};

const AgentRow: Component<AgentRowProps> = (props) => {
  const isSelected = createMemo(
    () => selectedAgentId() === props.agentId
  );

  const summaryLine = createMemo(() => {
    const a = props.agent;
    if (a.skills.length === 0 && a.mcps.length === 0 && a.subAgents.length === 0) {
      return "UNCONFIGURED";
    }
    const parts: string[] = [];
    if (a.skills.length > 0) parts.push(`${a.skills.length} SK`);
    if (a.mcps.length > 0) parts.push(`${a.mcps.length} MCP`);
    if (a.subAgents.length > 0) parts.push(`${a.subAgents.length} SUB`);
    return parts.join(" · ");
  });

  const modelDisplay = createMemo(() => {
    const modelKey = props.agent.model;
    if (!modelKey) return { label: "NO_MODEL", color: "text-base-content/30" };
    const cfg = models()[modelKey];
    const label = cfg?.model ?? modelKey;
    const provider = cfg?.provider?.toLowerCase() ?? "";
    const color = providerColor[provider] ?? "text-base-content/50";
    return { label, color };
  });

  return (
    <div
      class={`cursor-pointer px-3 py-2 transition-colors ${
        isSelected()
          ? "border-l-2 border-primary bg-primary/5"
          : "border-l-2 border-transparent hover:bg-base-200"
      }`}
      onClick={() => selectAgent(props.agentId)}
    >
      <div class="flex items-center gap-2">
        <div
          class={`w-1.5 h-1.5 rounded-full shrink-0 ${
            isSelected() ? "bg-primary" : "bg-base-content/25"
          }`}
        />
        <span class="text-sm font-bold truncate flex-1 min-w-0">
          {props.agent.agentId}
        </span>
        <span
          class={`text-[9px] font-bold uppercase tracking-wider shrink-0 ${modelDisplay().color}`}
        >
          {modelDisplay().label}
        </span>
      </div>
      <div class="text-[10px] text-base-content/50 pl-[18px]">
        {summaryLine()}
      </div>
    </div>
  );
};

export default AgentRow;
