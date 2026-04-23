import { api } from "./share.api";


export async function getAgents() {
  const { data, error } = await api.agents.all.get()
  if (error || !data) return {}

  return data
}
