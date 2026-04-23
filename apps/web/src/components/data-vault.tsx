import { createSignal, createEffect, For, Show } from "solid-js";
import type { FileType } from "../types/files";
import {
  getFileScheme,
  getFileExt,
  getFileType,
  getFileRarity,
} from "../stores/file.store";

import {
  fetchFiles, fetchFileContent,
  downloadFile,
  deleteFile,
  updateFileContent,
} from "../utils/api/file.api";

// ─── File Icon ────────────────────────────────────────────────────────────────

function FileIcon(props: {
  name: string;
  vpath: string;
  class?: string;
}) {
  const ext = () => getFileExt(props.name);
  const scheme = () => getFileScheme(props.vpath);

  const path = () => {
    const e = ext();
    if (["png", "jpg", "jpeg", "gif", "webp"].includes(e))
      return "M2.25 15.75l5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z";
    if (["json", "yaml", "yml", "toml", "csv"].includes(e))
      return "M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 2.625c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125m16.5 5.625c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125";
    if (["sh", "bash", "zsh", "fish", "ps1"].includes(e))
      return "m6.75 7.5 3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0 0 21 18V6a2.25 2.25 0 0 0-2.25-2.25H5.25A2.25 2.25 0 0 0 3 6v12a2.25 2.25 0 0 0 2.25 2.25Z";
    if (["md", "mdx", "txt", "rst"].includes(e))
      return "M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z";
    if (scheme() === "artifacts")
      return "M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456Z";
    // default: code file
    return "M17.25 6.75 22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3-4.5 16.5";
  };

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      stroke-width="1.5"
      stroke="currentColor"
      class={props.class ?? "w-5 h-5"}
    >
      <path stroke-linecap="round" stroke-linejoin="round" d={path()} />
    </svg>
  );
}

// ─── Empty slot fill ──────────────────────────────────────────────────────────

function EmptySlots(props: { count: number }) {
  return (
    <For each={Array(props.count).fill(null)}>
      {() => (
        <div class="aspect-square border border-dashed border-base-300/30 opacity-20" />
      )}
    </For>
  );
}

// ─── Scanline overlay ─────────────────────────────────────────────────────────

function Scanlines() {
  return (
    <div
      class="absolute inset-0 pointer-events-none opacity-20"
      style={{
        background:
          "repeating-linear-gradient(to bottom, transparent 0px, transparent 3px, rgba(0,0,0,0.15) 3px, rgba(0,0,0,0.15) 4px)",
      }}
    />
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface DataVaultProps {
  runId: string;
  onInject?: (fileId: string, fileName: string) => void;
  onClose: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function DataVault(props: DataVaultProps) {
  type FilterMode = "all" | "workspace" | "artifacts";

  const [files, setFiles] = createSignal<FileType[]>([]);
  const [selected, setSelected] = createSignal<FileType | null>(null);
  const [content, setContent] = createSignal("");
  const [editDraft, setEditDraft] = createSignal("");
  const [editing, setEditing] = createSignal(false);
  const [filter, setFilter] = createSignal<FilterMode>("all");

  const [loadingFiles, setLoadingFiles] = createSignal(true);
  const [loadingContent, setLoadingContent] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [deleting, setDeleting] = createSignal(false);

  // ── Load files ──

  const load = async () => {
    setLoadingFiles(true);
    const data = await fetchFiles(props.runId);
    setFiles(data);
    setLoadingFiles(false);
  };

  createEffect(() => {
    load();
  });

  const filtered = () => {
    const f = filter();
    const all = files();
    if (f === "all") return all;
    return all.filter((fi) =>
      f === "artifacts"
        ? fi.vpath.startsWith("artifacts://")
        : !fi.vpath.startsWith("artifacts://")
    );
  };

  const countWS = () =>
    files().filter((f) => !f.vpath.startsWith("artifacts://")).length;
  const countArt = () =>
    files().filter((f) => f.vpath.startsWith("artifacts://")).length;

  // ── Select file ──

  const select = async (file: FileType) => {
    setSelected(file);
    setEditing(false);
    setContent("");
    const ext = getFileExt(file.name);
    const imgExts = ["png", "jpg", "jpeg", "gif", "webp", "svg"];
    if (!imgExts.includes(ext)) {
      setLoadingContent(true);
      const text = await fetchFileContent(props.runId, file.id);
      setContent(text);
      setLoadingContent(false);
    }
  };

  const deselect = () => {
    setSelected(null);
    setContent("");
    setEditing(false);
  };

  // ── Actions ──

  const handleEdit = () => {
    setEditDraft(content());
    setEditing(true);
  };

  const handleSave = async () => {
    const file = selected();
    if (!file) return;
    setSaving(true);
    const ok = await updateFileContent(props.runId, file.id, editDraft());
    if (ok) {
      setContent(editDraft());
      setEditing(false);
    }
    setSaving(false);
  };

  const handleDelete = async () => {
    const file = selected();
    if (!file) return;
    setDeleting(true);
    const ok = await deleteFile(props.runId, file.id);
    if (ok) {
      setFiles((prev) => prev.filter((f) => f.id !== file.id));
      deselect();
    }
    setDeleting(false);
  };

  const handleDownload = () => {
    const file = selected();
    if (!file) return;
    downloadFile(props.runId, file.id, file.name.split("/").pop() ?? file.name);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div class="flex h-full bg-base-200 font-mono overflow-hidden">
      {/* ── Left: File Grid ─────────────────────────────────────────────── */}
      <div class="flex flex-col w-64 shrink-0 border-r border-base-300">
        {/* Header */}
        <div class="flex items-center justify-between px-3 py-3 border-b border-base-300 shrink-0">
          <div>
            <div class="text-[10px] font-bold uppercase tracking-widest text-primary flex items-center gap-1.5">
              <div class="w-1.5 h-1.5 bg-primary rounded-full animate-pulse shrink-0" />
              Data_Vault
            </div>
            <div class="text-[8px] text-base-content/30 mt-0.5 uppercase tracking-widest">
              {files().length} node{files().length !== 1 ? "s" : ""} indexed
            </div>
          </div>
          <div class="flex items-center gap-1">
            {/* Refresh */}
            <button
              class="btn btn-ghost btn-xs btn-circle opacity-50 hover:opacity-100"
              onClick={load}
              title="Refresh"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                stroke-width="2"
                stroke="currentColor"
                class="w-3.5 h-3.5"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.990"
                />
              </svg>
            </button>
            {/* Close vault */}
            <button
              class="btn btn-ghost btn-xs btn-circle opacity-50 hover:opacity-100"
              onClick={props.onClose}
              title="Close"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                stroke-width="2.5"
                stroke="currentColor"
                class="w-3 h-3"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M6 18 18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        </div>

        {/* Filter tabs */}
        <div class="flex gap-1 px-2 pt-2 pb-1.5 shrink-0 border-b border-base-300">
          {(["all", "workspace", "artifacts"] as FilterMode[]).map((tab) => (
            <button
              onClick={() => setFilter(tab)}
              class={`btn btn-xs font-bold uppercase tracking-wider flex-1 ${filter() === tab
                ? "btn-primary"
                : "btn-ghost border border-base-content/10 opacity-50 hover:opacity-100"
                }`}
            >
              {tab === "all"
                ? `ALL·${files().length}`
                : tab === "workspace"
                  ? `WS·${countWS()}`
                  : `ART·${countArt()}`}
            </button>
          ))}
        </div>

        {/* Grid */}
        <div class="flex-1 overflow-y-auto p-2">
          <Show when={loadingFiles()}>
            <div class="flex items-center justify-center h-24 gap-2">
              <div class="w-1 h-1 bg-primary rounded-full animate-bounce" style={{ "animation-delay": "0ms" }} />
              <div class="w-1 h-1 bg-primary rounded-full animate-bounce" style={{ "animation-delay": "150ms" }} />
              <div class="w-1 h-1 bg-primary rounded-full animate-bounce" style={{ "animation-delay": "300ms" }} />
            </div>
          </Show>

          <Show when={!loadingFiles() && filtered().length === 0}>
            <div class="flex flex-col items-center justify-center h-24 gap-2 opacity-30">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                stroke-width="1.5"
                stroke="currentColor"
                class="w-7 h-7"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z"
                />
              </svg>
              <span class="text-[9px] uppercase tracking-widest">
                Vault empty
              </span>
            </div>
          </Show>

          <Show when={!loadingFiles() && filtered().length > 0}>
            <div class="grid grid-cols-3 gap-1.5">
              <For each={filtered()}>
                {(file) => {
                  const sel = () => selected()?.id === file.id;
                  const scheme = () => getFileScheme(file.vpath);
                  const rarity = () => getFileRarity(file.name, file.vpath);
                  const shortName = () =>
                    file.name.split("/").pop()?.replace(/\.[^.]+$/, "") ??
                    file.name;

                  return (
                    <button
                      onClick={() => select(file)}
                      title={file.vpath}
                      class={`aspect-square flex flex-col items-center justify-center gap-1 border transition-all duration-150 p-1 relative group
                        ${sel()
                          ? "border-primary bg-primary/10 shadow-[0_0_10px_oklch(var(--p)/.2)]"
                          : "border-base-300/50 bg-base-300/20 hover:border-primary/40 hover:bg-base-300/50"
                        }`}
                    >
                      {/* Scheme dot */}
                      <div
                        class={`absolute top-1 left-1 w-1.5 h-1.5 rounded-full ${scheme() === "artifacts"
                          ? "bg-primary/70"
                          : "bg-secondary/60"
                          }`}
                      />

                      {/* Selected indicator */}
                      <Show when={sel()}>
                        <div class="absolute top-0 right-0 w-0 h-0 border-l-[8px] border-l-transparent border-t-[8px] border-t-primary" />
                      </Show>

                      {/* Icon */}
                      <div
                        class={`transition-colors ${sel()
                          ? "text-primary"
                          : "text-base-content/35 group-hover:text-primary/60"
                          }`}
                      >
                        <FileIcon
                          name={file.name}
                          vpath={file.vpath}
                          class="w-5 h-5"
                        />
                      </div>

                      {/* Name */}
                      <span class="text-[7px] uppercase tracking-wide truncate w-full text-center text-base-content/40 px-0.5 leading-none">
                        {shortName()}
                      </span>
                    </button>
                  );
                }}
              </For>

              {/* Pad to full row */}
              <EmptySlots
                count={(3 - (filtered().length % 3)) % 3}
              />
            </div>
          </Show>
        </div>
      </div>

      {/* ── Right: Detail Panel ──────────────────────────────────────────── */}
      <Show
        when={selected()}
        fallback={
          <div class="flex-1 flex flex-col items-center justify-center gap-3 opacity-20 select-none">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              stroke-width="1"
              stroke="currentColor"
              class="w-10 h-10"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M8.25 7.5V6.108c0-1.135.845-2.098 1.976-2.192.373-.03.748-.057 1.123-.08M15.75 18H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08M15.75 18.75v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5A3.375 3.375 0 0 0 6.375 7.5H5.25m11.9-3.664A2.251 2.251 0 0 0 15 2.25h-1.5a2.251 2.251 0 0 0-2.15 1.586m5.8 0c.065.21.1.433.1.664v.75h-6V4.5c0-.231.035-.454.1-.664M6.75 7.5H4.875c-.621 0-1.125.504-1.125 1.125v12c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V16.5a9 9 0 0 0-9-9Z"
              />
            </svg>
            <span class="text-[9px] uppercase tracking-widest">
              Select a node
            </span>
          </div>
        }
      >
        {(file) => {
          const rarity = () => getFileRarity(file().name, file().vpath);
          const type = () => getFileType(file().name, file().vpath);
          const scheme = () => getFileScheme(file().vpath);
          const ext = () => getFileExt(file().name);
          const isImage = () =>
            ["png", "jpg", "jpeg", "gif", "webp"].includes(ext());
          const shortName = () =>
            file().name.split("/").pop() ?? file().name;

          return (
            <div class="flex-1 flex flex-col overflow-hidden">
              {/* Detail header */}
              <div class="flex items-center justify-between px-4 py-3 border-b border-base-300 shrink-0">
                <span class="text-[10px] font-bold uppercase tracking-widest text-primary">
                  Artifact_Detail
                </span>
                <button
                  class="btn btn-ghost btn-xs btn-circle opacity-40 hover:opacity-100"
                  onClick={deselect}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke-width="2.5"
                    stroke="currentColor"
                    class="w-3 h-3"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      d="M6 18 18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </div>

              {/* Scrollable body */}
              <div class="flex-1 overflow-y-auto flex flex-col gap-4 p-4">
                {/* Preview area */}
                <div class="w-full aspect-video bg-base-300/40 border border-base-300 relative overflow-hidden flex items-center justify-center shrink-0">
                  <Scanlines />

                  {/* Scheme badge */}
                  <div
                    class={`absolute top-2 right-2 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-widest z-10 ${scheme() === "artifacts"
                      ? "bg-primary/20 text-primary border border-primary/30"
                      : "bg-secondary/20 text-secondary border border-secondary/30"
                      }`}
                  >
                    {scheme()}
                  </div>

                  {/* Edit mode label */}
                  <Show when={editing()}>
                    <div class="absolute inset-0 flex items-center justify-center bg-base-300/60 z-10">
                      <span class="text-[10px] text-primary uppercase tracking-widest animate-pulse font-bold">
                        ✎ Edit Mode
                      </span>
                    </div>
                  </Show>

                  {/* Content preview or icon */}
                  <Show
                    when={!editing() && content() && !isImage()}
                    fallback={
                      <div class="flex flex-col items-center gap-2 text-base-content/30">
                        <div class={rarity().cls}>
                          <FileIcon
                            name={file().name}
                            vpath={file().vpath}
                            class="w-8 h-8"
                          />
                        </div>
                        <span class="text-[9px] uppercase tracking-widest">
                          {shortName()}
                        </span>
                      </div>
                    }
                  >
                    <div class="absolute inset-0 p-2.5 overflow-hidden">
                      <pre class="text-[7px] text-base-content/25 leading-tight font-mono overflow-hidden h-full whitespace-pre-wrap break-all">
                        {content().slice(0, 800)}
                      </pre>
                      <div class="absolute bottom-0 inset-x-0 h-10 bg-gradient-to-t from-base-300/60 to-transparent" />
                    </div>
                  </Show>
                </div>

                {/* Metadata */}
                <div class="space-y-2.5 text-[10px] shrink-0">
                  <div class="border-b border-base-300 pb-2">
                    <div class="text-base-content/35 uppercase tracking-widest mb-0.5">
                      UID
                    </div>
                    <div class="text-base-content font-mono text-[9px] break-all opacity-70">
                      {file().id}
                    </div>
                  </div>
                  <div class="border-b border-base-300 pb-2">
                    <div class="text-base-content/35 uppercase tracking-widest mb-0.5">
                      TYPE
                    </div>
                    <div class="text-base-content">{type()}</div>
                  </div>
                  <div class="border-b border-base-300 pb-2">
                    <div class="text-base-content/35 uppercase tracking-widest mb-0.5">
                      NODE_PATH
                    </div>
                    <div class="text-base-content font-mono text-[9px] break-all opacity-60">
                      {file().vpath}
                    </div>
                  </div>
                  <div class="flex justify-between items-start">
                    <div>
                      <div class="text-base-content/35 uppercase tracking-widest mb-0.5">
                        NAME
                      </div>
                      <div class="text-base-content">{shortName()}</div>
                    </div>
                    <div class="text-right">
                      <div class="text-base-content/35 uppercase tracking-widest mb-0.5">
                        RARITY
                      </div>
                      <div class={`font-bold ${rarity().cls}`}>
                        {rarity().label}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Editor */}
                <Show when={editing()}>
                  <div class="flex flex-col gap-1.5">
                    <div class="text-[9px] text-primary uppercase tracking-widest font-bold">
                      Node_Editor
                    </div>
                    <Show
                      when={!loadingContent()}
                      fallback={
                        <div class="h-40 flex items-center justify-center">
                          <span class="text-[9px] text-base-content/30 animate-pulse uppercase tracking-widest">
                            Loading...
                          </span>
                        </div>
                      }
                    >
                      <textarea
                        class="textarea textarea-bordered w-full font-mono text-xs resize-none focus:textarea-primary bg-base-300/30 min-h-48"
                        value={editDraft()}
                        onInput={(e) => setEditDraft(e.currentTarget.value)}
                        spellcheck={false}
                      />
                    </Show>
                  </div>
                </Show>
              </div>

              {/* Actions — pinned bottom */}
              <div class="shrink-0 flex flex-col gap-1.5 p-4 border-t border-base-300">
                <Show when={!editing()}>
                  {/* Download */}
                  <button
                    class="btn btn-primary btn-sm w-full uppercase tracking-widest text-[10px] font-bold gap-2"
                    onClick={handleDownload}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke-width="2"
                      stroke="currentColor"
                      class="w-3.5 h-3.5"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3"
                      />
                    </svg>
                    Download_Asset
                  </button>

                  {/* Inject to chat */}
                  <Show when={props.onInject}>
                    <button
                      class="btn btn-sm w-full uppercase tracking-widest text-[10px] font-bold gap-2 border border-primary/30 bg-base-100 text-primary hover:bg-primary/10 transition-colors"
                      onClick={() =>
                        props.onInject?.(file().id, file().name)
                      }
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke-width="2"
                        stroke="currentColor"
                        class="w-3.5 h-3.5"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          d="m3.75 13.5 10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75Z"
                        />
                      </svg>
                      Inject_To_Chat
                    </button>
                  </Show>

                  {/* Edit node */}
                  <Show when={!isImage()}>
                    <button
                      class="btn btn-ghost btn-sm w-full uppercase tracking-widest text-[10px] font-bold gap-2 border border-base-300 hover:border-accent hover:text-accent transition-colors"
                      onClick={handleEdit}
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke-width="2"
                        stroke="currentColor"
                        class="w-3.5 h-3.5"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Z"
                        />
                      </svg>
                      Edit_Node
                    </button>
                  </Show>

                  {/* Delete */}
                  <button
                    class="btn btn-ghost btn-sm w-full uppercase tracking-widest text-[9px] font-bold text-error hover:bg-error/10 transition-colors mt-1"
                    onClick={handleDelete}
                    disabled={deleting()}
                  >
                    {deleting() ? "Purging node..." : "Delete_Node"}
                  </button>
                </Show>

                <Show when={editing()}>
                  <button
                    class="btn btn-primary btn-sm w-full uppercase tracking-widest text-[10px] font-bold gap-2"
                    onClick={handleSave}
                    disabled={saving()}
                  >
                    {saving() ? (
                      "Committing..."
                    ) : (
                      <>
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke-width="2"
                          stroke="currentColor"
                          class="w-3.5 h-3.5"
                        >
                          <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            d="m4.5 12.75 6 6 9-13.5"
                          />
                        </svg>
                        Commit_Changes
                      </>
                    )}
                  </button>
                  <button
                    class="btn btn-ghost btn-sm w-full uppercase tracking-widest text-[10px] font-bold border border-base-300"
                    onClick={() => setEditing(false)}
                    disabled={saving()}
                  >
                    Cancel
                  </button>
                </Show>
              </div>
            </div>
          );
        }}
      </Show>
    </div>
  );
}
