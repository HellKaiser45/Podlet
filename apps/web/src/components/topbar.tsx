import { Show } from "solid-js";
import { runId } from "../stores/chat.store";

export default function Topbar() {
  return (
    <div class="navbar bg-base-200 shadow-sm border-b border-neutral/30 justify-between">

      <div class="navbar-start gap-2">
        <span><span class="text-secondary">[</span>CONSOLE<span class="text-secondary">]</span></span>
      </div>

      <div class="navbar-center hidden lg:flex">
      </div>

      <div class="navbar-end">
        <Show when={runId()}>
          <label for="my-drawer-2" class="btn btn-sm btn-primary">
            Open drawer
          </label>
        </Show>
      </div>
    </div>
  )
}
