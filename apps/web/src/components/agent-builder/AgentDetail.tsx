import { type Component, Show, createEffect, createSignal, untrack } from "solid-js";
import { useNavigate } from "@solidjs/router";
import uuidv4 from "../../utils/uuid";
import {
  selectedAgent,
  selectedAgentId,
  pendingDelete,
  saveStatus,
  updateAgentField,
  renameAgent,
  confirmDelete,
  initiateChat,
} from "../../stores/agent-builder.store";
import ModelSelector from "./ModelSelector";
import PromptEditor from "./PromptEditor";
import SkillPicker from "./SkillPicker";
import McpPicker from "./McpPicker";
import SubAgentPicker from "./SubAgentPicker";
import DeleteConfirmBanner from "./DeleteConfirmBanner";
import EmptyDetailState from "./EmptyDetailState";

const SectionLabel: Component<{ label: string; count?: number }> = (props) => (
  <div class="text-[10px] font-bold uppercase tracking-widest text-primary mb-1.5">
    {props.label}
    <Show when={props.count !== undefined}>
      <span class="text-base-content/40 ml-1">({props.count})</span>
    </Show>
  </div>
);

const AgentDetail: Component = () => {
  const agent = selectedAgent;
  const navigate = useNavigate();

  const [idDraft, setIdDraft] = createSignal("");
  const [idError, setIdError] = createSignal(false);
  let idInputRef: HTMLInputElement | undefined;
  let renameInFlight = false;

  createEffect(() => {
    selectedAgentId();
    untrack(() => setIdDraft(agent()?.agentId ?? ""));
    setIdError(false);
  });

  const commitId = (userCommitted: boolean) => {
    const current = agent()?.agentId;
    if (!current || renameInFlight) return;
    const val = idDraft().trim();
    if (!val || val === current) {
      setIdDraft(current);
      setIdError(false);
      return;
    }
    if (!/^[a-zA-Z0-9_-]{1,58}$/.test(val)) {
      setIdError(true);
      if (userCommitted) {
        idInputRef?.focus();
      } else {
        setIdDraft(current);
      }
      return;
    }
    setIdError(false);
    renameInFlight = true;
    setIdDraft(val);
    renameAgent(val).then((ok) => {
      renameInFlight = false;
      if (!ok) {
        setIdDraft(agent()?.agentId ?? val);
      }
    });
  };

  const onIdKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commitId(true);
      if (!idError()) idInputRef?.blur();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setIdDraft(agent()?.agentId ?? "");
      setIdError(false);
      idInputRef?.blur();
    }
  };

  const onDescriptionBlur = (e: FocusEvent) => {
    const val = (e.target as HTMLTextAreaElement).value;
    updateAgentField({ agentDescription: val });
  };

  const statusColor = () => {
    switch (saveStatus()) {
      case "SAVED":
        return "text-success";
      case "SAVING":
        return "text-warning";
      case "ERROR":
        return "text-error";
      default:
        return "";
    }
  };

  const statusText = () => {
    switch (saveStatus()) {
      case "SAVED":
        return "SAVED";
      case "SAVING":
        return "SAVING...";
      case "ERROR":
        return "ERROR";
      default:
        return "";
    }
  };

  return (
    <Show
      when={selectedAgentId() !== null}
      fallback={<EmptyDetailState />}
    >
      <div class="h-full overflow-y-auto flex flex-col bg-base-100 border border-base-content/10">
        {/* Header */}
        <div class="flex items-center justify-between px-4 py-3 border-b border-base-content/10">
          <div class="flex flex-col min-w-0 flex-1">
            <Show when={idError()}>
              <div id="agent-id-error" class="text-[10px] font-bold uppercase text-error leading-none mb-1">
                ID: letters, digits, - and _ only, max 58
              </div>
            </Show>
            <input
              ref={(el) => (idInputRef = el)}
              class="w-full min-w-0 truncate text-lg font-bold font-mono bg-transparent border-none outline-none focus:outline-none px-0"
              aria-label="Agent ID"
              aria-invalid={idError()}
              aria-describedby={idError() ? "agent-id-error" : undefined}
              value={idDraft()}
              onInput={(e) => setIdDraft(e.currentTarget.value)}
              onBlur={() => commitId(false)}
              onKeyDown={onIdKeyDown}
              spellcheck={false}
            />
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <button
              class="btn btn-primary btn-sm text-xs"
              onClick={() => {
                const id = agent()?.agentId;
                if (id) {
                  const runId = uuidv4();
                  initiateChat(id);
                  navigate("/chat/" + runId);
                }
              }}
            >
              INITIATE
            </button>
            <button
              class="btn btn-ghost btn-sm text-xs text-error hover:bg-error/10"
              onClick={confirmDelete}
            >
              DELETE
            </button>
          </div>
        </div>

        {/* Description */}
        <div class="px-4 py-3 border-b border-base-content/10">
          <textarea
            class="textarea textarea-bordered w-full font-mono text-xs resize-none min-h-[48px] bg-base-200 focus:textarea-primary"
            value={agent()?.agentDescription ?? ""}
            onBlur={onDescriptionBlur}
            spellcheck={false}
            placeholder="AGENT_DESCRIPTION..."
          />
        </div>

        {/* Model */}
        <div class="px-4 py-3 border-b border-base-content/10">
          <SectionLabel label="MODEL" />
          <ModelSelector />
        </div>

        {/* Core Directives */}
        <div class="px-4 py-3 border-b border-base-content/10">
          <PromptEditor />
        </div>

        {/* Skills */}
        <div class="px-4 py-3 border-b border-base-content/10">
          <SectionLabel label="SKILLS" count={agent()?.skills?.length ?? 0} />
          <SkillPicker />
        </div>

        {/* MCPs */}
        <div class="px-4 py-3 border-b border-base-content/10">
          <SectionLabel label="MCPS" count={agent()?.mcps?.length ?? 0} />
          <McpPicker />
        </div>

        {/* Sub-Agents */}
        <div class="px-4 py-3 border-b border-base-content/10">
          <SectionLabel label="SUB_AGENTS" count={agent()?.subAgents?.length ?? 0} />
          <SubAgentPicker />
        </div>

        {/* Delete confirmation */}
        <Show when={pendingDelete()}>
          <div class="px-4 py-3 border-b border-base-content/10">
            <DeleteConfirmBanner />
          </div>
        </Show>

        {/* Save status */}
        <Show when={saveStatus() !== "IDLE"}>
          <div class="px-4 py-2 flex justify-end">
            <span class={`text-[10px] font-bold uppercase ${statusColor()}`}>
              {statusText()}
            </span>
          </div>
        </Show>
      </div>
    </Show>
  );
};

export default AgentDetail;
