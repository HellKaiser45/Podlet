import { createAsync, useNavigate, query, revalidate } from "@solidjs/router";
import { api } from "../utils/api/share.api";
import { createSignal, For, Show } from "solid-js";
import { Portal } from "solid-js/web";

export const getRunIds = query(async () => {
  const { data, error } = await api.runids.get();
  if (error) throw error;
  return data;
}, "runIds");

function SidebarTooltip(props: { text: string; x: number; y: number }) {
  return (
    <Portal>
      <div
        class="fixed z-9999 pointer-events-none -translate-y-1/2 px-2 py-1 rounded text-xs bg-base-content text-base-100 whitespace-nowrap shadow"
        style={{ left: `${props.x}px`, top: `${props.y}px` }}
      >
        {props.text}
      </div>
    </Portal>
  );
}

export default function Sidebar(props: { children: any }) {
  const runids = createAsync(() => getRunIds());
  const navigate = useNavigate();

  const [tooltip, setTooltip] = createSignal<{ text: string; x: number; y: number } | null>(null);

  const showTooltip = (e: MouseEvent, text: string) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setTooltip({ text, x: rect.right + 8, y: rect.top + rect.height / 2 });
  };
  const hideTooltip = () => setTooltip(null);

  return (
    <div class="drawer lg:drawer-open min-h-screen">
      <input id="sidebar-drawer" type="checkbox" class="drawer-toggle" />

      <Show when={tooltip()}>
        {(t) => <SidebarTooltip text={t().text} x={t().x} y={t().y} />}
      </Show>

      <div class="drawer-content flex flex-col">
        <header class="navbar bg-base-100 border-b border-base-300 lg:hidden">
          <label for="sidebar-drawer" class="btn btn-ghost btn-square">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" class="inline-block w-6 h-6 stroke-current">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </label>
          <span class="flex-1 px-2 font-bold tracking-tighter">PODLET</span>
        </header>
        <main class="flex-1 overflow-auto">{props.children}</main>
      </div>

      <div class="drawer-side z-20">
        <label for="sidebar-drawer" aria-label="close sidebar" class="drawer-overlay" />

        <div class="flex min-h-full flex-col bg-base-200 border-r border-base-300 is-drawer-close:w-14 is-drawer-open:w-64 transition-[width] duration-300">

          <div class="flex items-center justify-between p-3 min-h-16">
            <div class="flex items-center gap-3 is-drawer-close:hidden">

              <span class="font-bold tracking-tight text-xl">PODLET</span>
            </div>
            <label
              for="sidebar-drawer"
              class="btn btn-ghost btn-xs btn-square is-drawer-close:mx-auto"
              onMouseEnter={(e) => showTooltip(e, "Toggle sidebar")}
              onMouseLeave={hideTooltip}
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path d="M9 4v16M14 10l2 2l-2 2M4 4m0 2a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-12a2 2 0 0 1-2-2z" />
              </svg>
            </label>
          </div>

          <div class="px-3 mb-2">
            <button
              class="btn btn-primary btn-sm w-full gap-2 is-drawer-close:btn-square is-drawer-close:w-10 is-drawer-close:mx-auto"
              onClick={() => navigate(`/chat/${crypto.randomUUID()}`)}
              onMouseEnter={(e) => showTooltip(e, "New Chat")}
              onMouseLeave={hideTooltip}
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="size-4 shrink-0">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              <span class="is-drawer-close:hidden">New Chat</span>
            </button>
          </div>

          <ul class="menu menu-md w-full px-2 gap-1">
            <li>
              <button
                class="flex items-center gap-2"
                onClick={() => navigate("/")}
                onMouseEnter={(e) => showTooltip(e, "Homepage")}
                onMouseLeave={hideTooltip}
              >
                <svg xmlns="http://www.w3.org/2000/svg" class="size-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" />
                  <path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                </svg>
                <span class="is-drawer-close:hidden">Homepage</span>
              </button>
            </li>
          </ul>

          <div class="is-drawer-close:hidden px-4 py-1">
            <span class="text-xs opacity-50 uppercase tracking-widest">History</span>
          </div>
          <div class="divider is-drawer-close:hidden my-0 px-4" />

          <ul class="menu menu-md w-full px-2 gap-0.5 grow overflow-y-auto">
            <For each={runids()}>
              {(runid) => {
                const [label, setLabel] = createSignal(runid.label || runid.preview || runid.runId);
                const [isEditing, setIsEditing] = createSignal(false);

                const saveLabel = async (newLabel: string) => {
                  const trimmed = newLabel.trim();
                  if (!trimmed || trimmed === label()) return setIsEditing(false);
                  setLabel(trimmed);
                  await api.history.label({ runid: runid.runId }).patch({ label: trimmed });
                  setIsEditing(false);
                };

                const deleteRun = async (e: MouseEvent) => {
                  e.stopPropagation();
                  hideTooltip();
                  await api.chat({ runid: runid.runId }).delete()
                  revalidate('runIds')
                };

                return (
                  <li class="group w-full">
                    <div
                      class="flex items-center gap-1.5 cursor-pointer w-full"
                      onClick={() => !isEditing() && navigate(`/chat/${runid.runId}`)}
                      onMouseEnter={(e) => showTooltip(e, label())}
                      onMouseLeave={hideTooltip}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" class="size-4 shrink-0 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 0 1 .865-.501 48.172 48.172 0 0 0 3.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z" />
                      </svg>

                      <div class="is-drawer-close:hidden flex items-center gap-1 flex-1 min-w-0">
                        {isEditing() ? (
                          <input
                            type="text"
                            class="input input-xs flex-1 min-w-0 bg-base-100 border-primary focus:outline-none"
                            value={label()}
                            autofocus
                            onBlur={(e) => saveLabel(e.currentTarget.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") saveLabel(e.currentTarget.value);
                              if (e.key === "Escape") setIsEditing(false);
                            }}
                            onClick={async (e) => {
                              e.stopPropagation();
                            }}
                          />
                        ) : (
                          <>
                            <span class="text-sm truncate flex-1 min-w-0 opacity-80">{label()}</span>

                            <span
                              class="shrink-0 opacity-0 group-hover:opacity-40 hover:opacity-100 hover:text-warning transition-opacity cursor-pointer"
                              onClick={(e) => { e.stopPropagation(); hideTooltip(); setIsEditing(true); }}
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-3.5">
                                <path stroke-linecap="round" stroke-linejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Zm0 0L19.5 7.125" />
                              </svg>
                            </span>

                            <span
                              class="shrink-0 opacity-0 group-hover:opacity-40 hover:opacity-100 hover:text-error transition-opacity cursor-pointer"
                              onClick={deleteRun}
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-3.5">
                                <path stroke-linecap="round" stroke-linejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                              </svg>
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </li>
                );
              }}
            </For>
          </ul>

        </div>
      </div>
    </div>
  );
}
