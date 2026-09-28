import { Show } from "solid-js";
import { runId } from "../stores/chat.store";

export default function Topbar() {
  return (
    <div class="navbar bg-base-200 shadow-sm border-b border-neutral/30 justify-between">
      <div class="navbar-start gap-2">
        <span><span class="text-secondary">[</span>CONSOLE<span class="text-secondary">]</span></span>
      </div>
      <div class="navbar-center hidden lg:flex"></div>
      <div class="navbar-end">
        <Show when={runId()}>
          <label for="my-drawer-2" class="btn btn-sm btn-ghost gap-1.5">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-4">
              <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
            </svg>
            <span class="text-xs uppercase tracking-wide opacity-70">Files</span>
          </label>
        </Show>
      </div>
    </div>
  )
}
