import { createSignal } from "solid-js"

export const [selectedAgent, setSelectedAgent] = createSignal<string | null>(null)

