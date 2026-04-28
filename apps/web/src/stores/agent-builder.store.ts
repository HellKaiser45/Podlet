import { createSignal } from "solid-js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface Agent {
  agentId: string;
  agentDescription: string;
  model: string;
  system_prompt: string;
  mcps: string[];
  skills: string[];
  subAgents: string[];
}

export interface ModelConfig {
  provider: string;
  model: string;
  baseURL?: string;
  apiKeyEnvVar: string;
}

export interface MCPServerConfig {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface SkillInfo {
  name: string;
  description: string;
}

// ─── Base URL ─────────────────────────────────────────────────────────────────

const BASE = (import.meta.env?.VITE_API_URL ?? "http://localhost:3000") + "/api";

// ─── API Functions ────────────────────────────────────────────────────────────

async function fetchAgents(): Promise<Record<string, Agent>> {
  try {
    const res = await fetch(BASE + "/agents/all");
    return await res.json();
  } catch {
    return {};
  }
}

async function fetchModels(): Promise<Record<string, ModelConfig>> {
  try {
    const res = await fetch(BASE + "/models/all");
    return await res.json();
  } catch {
    return {};
  }
}

async function fetchMcps(): Promise<Record<string, MCPServerConfig>> {
  try {
    const res = await fetch(BASE + "/mcps/all");
    return await res.json();
  } catch {
    return {};
  }
}

async function fetchSkills(): Promise<SkillInfo[]> {
  try {
    const res = await fetch(BASE + "/skills/all");
    return await res.json();
  } catch {
    return [];
  }
}

async function fetchPrompts(): Promise<string[]> {
  try {
    const res = await fetch(BASE + "/prompts/all");
    return await res.json();
  } catch {
    return [];
  }
}

async function _createAgentApi(agent: Agent): Promise<boolean> {
  try {
    const res = await fetch(BASE + "/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(agent),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function updateAgent(
  agentId: string,
  patch: Partial<Agent>
): Promise<boolean> {
  try {
    const res = await fetch(BASE + "/agents/" + encodeURIComponent(agentId), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function deleteAgent(agentId: string): Promise<boolean> {
  try {
    const res = await fetch(BASE + "/agents/" + encodeURIComponent(agentId), {
      method: "DELETE",
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ─── Signals ─────────────────────────────────────────────────────────────────

const [agents, setAgents] = createSignal<Record<string, Agent>>({});
const [models, setModels] = createSignal<Record<string, ModelConfig>>({});
const [mcps, setMcps] = createSignal<Record<string, MCPServerConfig>>({});
const [skills, setSkills] = createSignal<SkillInfo[]>([]);
const [prompts, setPrompts] = createSignal<string[]>([]);
const [selectedAgentId, setSelectedAgentId] = createSignal<string | null>(null);
const [pendingDelete, setPendingDelete] = createSignal(false);
const [saveStatus, setSaveStatus] = createSignal<
  "IDLE" | "SAVING" | "SAVED" | "ERROR"
>("IDLE");

// ─── Derived Signals ─────────────────────────────────────────────────────────

export function selectedAgent(): Agent | undefined {
  return agents()[selectedAgentId() ?? ""];
}

export function otherAgents(): Agent[] {
  const sel = selectedAgentId();
  return Object.values(agents()).filter((a) => a.agentId !== sel);
}

// ─── Actions ─────────────────────────────────────────────────────────────────

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

export async function loadAll(): Promise<void> {
  const [a, m, c, s, p] = await Promise.all([
    fetchAgents(),
    fetchModels(),
    fetchMcps(),
    fetchSkills(),
    fetchPrompts(),
  ]);
  setAgents(a);
  setModels(m);
  setMcps(c);
  setSkills(s);
  setPrompts(p);
}

export function selectAgent(id: string | null): void {
  setSelectedAgentId(id);
  setPendingDelete(false);
}

export async function createNewAgent(): Promise<Agent> {
  const agent: Agent = {
    agentId: "new-agent",
    agentDescription: "",
    model: "",
    system_prompt: "",
    mcps: [],
    skills: [],
    subAgents: [],
  };
  const ok = await _createAgentApi(agent);
  if (ok) {
    setAgents((prev) => ({ ...prev, [agent.agentId]: agent }));
    setSelectedAgentId(agent.agentId);
  }
  return agent;
}

export async function updateAgentField(
  patch: Partial<Agent>
): Promise<void> {
  const id = selectedAgentId();
  if (!id) return;

  const current = agents()[id];
  if (!current) return;

  const merged = { ...current, ...patch };
  setAgents((prev) => ({ ...prev, [id]: merged }));

  const debouncedFields: (keyof Agent)[] = ["system_prompt", "agentDescription"];
  const hasDebouncedField = debouncedFields.some((k) => k in patch);

  const doSave = async () => {
    setSaveStatus("SAVING");
    const ok = await updateAgent(id, patch);
    setSaveStatus(ok ? "SAVED" : "ERROR");
  };

  if (hasDebouncedField) {
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      doSave();
    }, 500);
  } else {
    await doSave();
  }
}

export function confirmDelete(): void {
  setPendingDelete(true);
}

export function cancelDelete(): void {
  setPendingDelete(false);
}

export async function executeDelete(): Promise<void> {
  const id = selectedAgentId();
  if (!id) return;
  const ok = await deleteAgent(id);
  if (ok) {
    setAgents((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setSelectedAgentId(null);
    setPendingDelete(false);
  }
}

export async function initiateChat(agentId: string): Promise<void> {
  const { setSelectedAgent } = await import("./chatInput.store");
  setSelectedAgent(agentId);
}

// ─── Exported Signal Getters ─────────────────────────────────────────────────

export {
  agents,
  models,
  mcps,
  skills,
  prompts,
  selectedAgentId,
  pendingDelete,
  saveStatus,
};
