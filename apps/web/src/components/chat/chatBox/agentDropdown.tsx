import { createAsync, query } from "@solidjs/router"
import { getAgents } from "../../../utils/api/agent.api"
import { For, Show, createEffect } from "solid-js"
import { selectedAgent, setSelectedAgent } from "../../../stores/chatInput.store"

const myAgents = query(async () => {
  return await getAgents()
}, "agents")

export default function AgentDropdown() {
  const agents = createAsync(() => myAgents())

  const firstAgentId = () => {
    const data = agents();
    return data ? Object.keys(data)[0] : null;
  };

  const currentAgent = () => selectedAgent() || firstAgentId();

  createEffect(() => {
    const data = agents()
    if (!data) return
    if (selectedAgent()) return

    const firstId = Object.keys(data)[0]
    if (firstId) setSelectedAgent(firstId)
  })

  return (
    <div class="flex gap-1">
      <p class="label text-xs opacity-50">TRANSMIT TO</p>
      <div class="dropdown dropdown-top dropdown-start">
        <div tabindex="0" role="button" class="btn btn-xs btn-ghost border border-base-content/20  w-28 justify-between">
          <span class="truncate">
            <Show when={agents()} fallback={'loading ...'}>
              {currentAgent()}
            </Show>
          </span>
        </div>
        <ul tabindex="-1" class="dropdown-content  menu menu-sm w-48 z-100 shadow-lg bg-base-200 border border-base-content/10  mb-2">
          <For each={Object.keys(agents() || {}).filter(id => id !== currentAgent())}>
            {(agentId) => (
              <li><a class="text-xs text-base-content/66 bg-base-200" onClick={() => {
                setSelectedAgent(agentId),
                  (document.activeElement as HTMLElement)?.blur();
              }}
              >
                {
                  agents()?.[agentId]?.agentId
                }</a></li>
            )}
          </For>
        </ul>
      </div>
    </div>
  )
}
