import { query, createAsync, revalidate } from "@solidjs/router";
import { runId } from "../../stores/chat.store";
import { api, BASE_URL } from "../../utils/api/share.api";
import FileTree from "./fileTree";
import { groupFilesByOrigin, downloadFile, downloadFolder } from "../../utils/api/file.api";
import { createSignal, Show, Suspense, createEffect } from "solid-js";
import { Marked } from 'marked';
import { markedHighlight } from "marked-highlight";
import hljs from 'highlight.js';
import 'highlight.js/styles/github-dark.css';

const marked = new Marked(
  markedHighlight({
    langPrefix: 'hljs language-',
    highlight(code, lang) {
      const language = hljs.getLanguage(lang) ? lang : 'plaintext';
      return hljs.highlight(code, { language }).value;
    }
  })
);

const getInvoiceQuery = query(async (id?: string) => {
  if (!id) return;
  const { data, error } = await api.file.all({ runid: id }).get();
  if (error) throw error;
  return groupFilesByOrigin(data);
}, "invoice");

const getItemContent = query(async (itemId?: string, runIdValue?: string) => {
  if (!runIdValue || !itemId) return;
  const res = await api.file.download({ runid: runIdValue })({ fileid: itemId }).get();
  const mime = res.response.headers.get('Content-Type') || '';
  return {
    itemId,
    runId: runIdValue,
    isImage: mime.startsWith('image'),
    content: mime.startsWith('image') ? '' : res.data,
  };
}, 'content');

function HighlightedCode(props: { content: any; lang: string }) {
  const html = () => {
    const language = hljs.getLanguage(props.lang) ? props.lang : 'plaintext';
    let codeString = "";
    if (typeof props.content === 'string') {
      codeString = props.content;
    } else if (props.content && typeof props.content === 'object') {
      codeString = props.content.content || JSON.stringify(props.content, null, 2);
    }
    return hljs.highlight(codeString, { language }).value;
  };
  return (
    <div class="rounded-lg border border-base-300 bg-base-300/40 overflow-hidden h-full flex flex-col">
      <div class="flex items-center gap-1.5 px-3 py-2 border-b border-base-300 bg-base-200/60 shrink-0">
        <span class="w-2.5 h-2.5 rounded-full bg-error/50" />
        <span class="w-2.5 h-2.5 rounded-full bg-warning/50" />
        <span class="w-2.5 h-2.5 rounded-full bg-success/50" />
        <span class="ml-auto text-[10px] font-mono text-base-content/30 tracking-widest">{props.lang}</span>
      </div>
      <div class="overflow-auto flex-1 p-4">
        <pre class="text-xs leading-relaxed m-0">
          <code class={`hljs language-${props.lang}`} innerHTML={html()} />
        </pre>
      </div>
    </div>
  );
}

function MarkdownPreview(props: { content: string }) {
  const html = () => {
    const rawContent = typeof props.content === 'string' ? props.content : JSON.stringify(props.content ?? "");
    return marked.parse(rawContent) as string;
  };
  return (
    <div class="rounded-lg border border-base-300 bg-base-300/40 overflow-hidden h-full flex flex-col">
      <div class="flex items-center gap-1.5 px-3 py-2 border-b border-base-300 bg-base-200/60 shrink-0">
        <span class="w-2.5 h-2.5 rounded-full bg-error/50" />
        <span class="w-2.5 h-2.5 rounded-full bg-warning/50" />
        <span class="w-2.5 h-2.5 rounded-full bg-success/50" />
        <span class="ml-auto text-[10px] font-mono text-base-content/30 tracking-widest">md</span>
      </div>
      <div
        class="overflow-auto flex-1 p-4 prose prose-sm prose-invert max-w-none prose-pre:bg-base-300/60 prose-pre:border prose-pre:border-base-300 prose-code:text-primary/80 prose-headings:text-base-content/90"
        innerHTML={html()}
      />
    </div>
  );
}

function EditPreview(props: { content: string; onChange: (v: string) => void }) {
  return (
    <div class="rounded-lg border border-primary/40 bg-base-300/40 overflow-hidden h-full flex flex-col">
      <div class="flex items-center gap-1.5 px-3 py-2 border-b border-primary/30 bg-base-200/60 shrink-0">
        <span class="w-2.5 h-2.5 rounded-full bg-error/50" />
        <span class="w-2.5 h-2.5 rounded-full bg-warning/50" />
        <span class="w-2.5 h-2.5 rounded-full bg-success/50" />
        <span class="ml-auto text-[10px] font-mono text-primary/60 tracking-widest">EDITING</span>
      </div>
      <textarea
        class="flex-1 resize-none bg-transparent font-mono text-xs text-base-content/85 p-3 outline-none leading-relaxed"
        value={props.content}
        onInput={(e) => props.onChange(e.currentTarget.value)}
      />
    </div>
  );
}

function ImagePreview(props: { src: string }) {
  return (
    <div class="rounded-lg border border-base-300 overflow-hidden bg-base-300/20 flex items-center justify-center p-3 h-full">
      <img src={props.src} alt="preview" class="max-w-full max-h-full w-auto h-auto object-contain rounded" />
    </div>
  );
}

function PreviewSkeleton() {
  return (
    <div class="rounded-lg border border-base-300 overflow-hidden animate-pulse h-full flex flex-col">
      <div class="h-8 bg-base-300/60 border-b border-base-300 shrink-0" />
      <div class="p-3 space-y-2 flex-1">
        {Array.from({ length: 8 }).map((_, i) => (
          <div class="h-3 bg-base-300/60 rounded" style={{ width: `${50 + (i * 17) % 45}%` }} />
        ))}
      </div>
    </div>
  );
}

function ActionBtn(props: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: 'default' | 'primary' | 'danger';
}) {
  const base = "text-[10px] font-mono tracking-widest px-2 py-0.5 rounded border transition-colors disabled:opacity-40";
  const variants = {
    default: "border-base-300 text-base-content/50 hover:text-base-content hover:border-base-content/40",
    primary: "border-primary/60 text-primary hover:bg-primary hover:text-base-100",
    danger: "border-error/60 text-error hover:bg-error hover:text-base-100",
  };
  return (
    <button
      class={`${base} ${variants[props.variant ?? 'default']}`}
      onClick={props.onClick}
      disabled={props.disabled}
    >
      {props.label}
    </button>
  );
}

export default function SideDrawer() {
  const invoices = createAsync(() => getInvoiceQuery(runId()));
  const [selectedFile, setSelectedFile] = createSignal<{ id: string; name: string; vpath: string; type: 'text' | 'image' } | null>(null);
  const content = createAsync(() => getItemContent(selectedFile()?.id || '', runId()));

  const [activeMenu, setActiveMenu] = createSignal<'workspace' | 'artifact'>('workspace');
  const [isEditing, setIsEditing] = createSignal(false);
  const [editContent, setEditContent] = createSignal('');
  const [isSaving, setIsSaving] = createSignal(false);
  const [isDeleting, setIsDeleting] = createSignal(false);
  const [confirmDelete, setConfirmDelete] = createSignal(false);
  const [treeHeight, setTreeHeight] = createSignal(50);

  const fileExt = () => {
    const name = selectedFile()?.name ?? '';
    return name.includes('.') ? name.split('.').pop()! : 'plaintext';
  };

  const isMarkdown = () => ['md', 'mdx'].includes(fileExt());

  createEffect(() => {
    selectedFile();
    setIsEditing(false);
    setConfirmDelete(false);
  });

  const handleEdit = () => {
    setEditContent(content()?.content as string ?? '');
    setIsEditing(true);
  };

  const handleSave = async () => {
    const c = content();
    if (!c || !runId()) return;
    setIsSaving(true);
    try {
      await api.file({ runid: runId()! })({ fileid: c.itemId }).patch(editContent());
      await revalidate('content');
      setIsEditing(false);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    const c = content();
    if (!c || !runId()) return;
    setIsDeleting(true);
    try {
      await api.file({ runid: runId()! })({ fileid: c.itemId }).delete();
      setSelectedFile(null);
      await revalidate('invoice');
      await revalidate('content');
      setConfirmDelete(false);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleDownload = async () => {
    const f = selectedFile();
    if (!f || !runId()) return;
    try {
      await downloadFile(runId()!, f.id, f.name);
    } catch (e) {
      console.error('Download failed:', e);
    }
  };

  const handleDownloadFolder = async (folder: { fullPath: string; name: string }) => {
    if (!runId()) return;
    const scheme = activeMenu() === 'workspace' ? 'workspace://' : 'artifacts://';
    const folderId = btoa(scheme + folder.fullPath).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    try {
      await downloadFolder(runId()!, folderId, folder.name);
    } catch (e) {
      console.error('Folder download failed:', e);
    }
  };

  const currentFiles = () => {
    const data = invoices();
    if (!data) return [];
    return activeMenu() === 'workspace' ? data.workspace : data.artifact;
  };

  return (
    <div class="drawer drawer-end fixed inset-0 pointer-events-none z-40">
      <input id="my-drawer-2" type="checkbox" class="drawer-toggle" />
      <div class="drawer-side z-40">
        <label for="my-drawer-2" aria-label="close sidebar" class="drawer-overlay" />

        <div class="flex flex-col h-full w-2xl bg-base-200 shadow-xl">

          {/* ── Tabs ── */}
          <div class="flex border-b border-base-300 px-2 pt-3 gap-1 shrink-0">
            {(['workspace', 'artifact'] as const).map((tab) => (
              <button
                class="flex-1 py-1.5 text-xs font-semibold tracking-widest uppercase rounded-t transition-colors"
                classList={{
                  'bg-base-100 text-primary border border-b-0 border-base-300': activeMenu() === tab,
                  'text-base-content/40 hover:text-base-content/70': activeMenu() !== tab,
                }}
                onClick={() => { setActiveMenu(tab); setSelectedFile(null); }}
              >
                {tab}
              </button>
            ))}
          </div>

          {/* ── File Tree (top section) ── */}
          <div class="border-b border-base-300 overflow-hidden" style={{ height: `${treeHeight()}%` }}>
            <div class="px-2 pt-2 pb-1">
              <p class="text-[10px] font-mono text-primary/50 tracking-widest px-1">
                {activeMenu().toUpperCase()}://
              </p>
            </div>
            <div class="h-[calc(100%-28px)]">
              <Suspense fallback={
                <div class="flex flex-col gap-1 p-2">
                  {Array.from({ length: 6 }).map(() => (
                    <div class="h-6 bg-base-300/60 animate-pulse rounded" />
                  ))}
                </div>
              }>
                <FileTree
                  files={currentFiles()}
                  selectedId={selectedFile()?.id ?? null}
                  onSelectFile={setSelectedFile}
                  onDownloadFile={(f) => downloadFile(runId()!, f.id, f.name).catch(e => console.error('Download failed:', e))}
                  onDownloadFolder={handleDownloadFolder}
                />
              </Suspense>
            </div>
          </div>

          {/* ── Resize handle ── */}
          <div class="h-1 bg-base-300/60 hover:bg-primary/30 cursor-row-resize shrink-0 transition-colors" />

          {/* ── Preview panel (bottom section) ── */}
          <div class="flex-1 flex flex-col min-h-0 p-3">

            <div class="flex items-center justify-between mb-2 px-0.5 shrink-0">
              <p class="text-[10px] font-mono text-primary/50 tracking-widest">PREVIEW://</p>

              <Show when={content()}>
                <div class="flex items-center gap-1.5">

                  <Show when={!isEditing()}>
                    <ActionBtn label="DOWNLOAD" onClick={handleDownload} />
                  </Show>

                  <Show when={!content()?.isImage}>
                    <Show
                      when={isEditing()}
                      fallback={<ActionBtn label="EDIT" onClick={handleEdit} />}
                    >
                      <ActionBtn label="CANCEL" onClick={() => setIsEditing(false)} />
                      <ActionBtn
                        label={isSaving() ? 'SAVING…' : 'SAVE'}
                        variant="primary"
                        disabled={isSaving()}
                        onClick={handleSave}
                      />
                    </Show>
                  </Show>

                  <Show when={!isEditing()}>
                    <Show
                      when={confirmDelete()}
                      fallback={<ActionBtn label="DELETE" variant="danger" onClick={() => setConfirmDelete(true)} />}
                    >
                      <ActionBtn label="CANCEL" onClick={() => setConfirmDelete(false)} />
                      <ActionBtn
                        label={isDeleting() ? 'DELETING…' : 'CONFIRM'}
                        variant="danger"
                        disabled={isDeleting()}
                        onClick={handleDelete}
                      />
                    </Show>
                  </Show>

                </div>
              </Show>
            </div>

            <div class="flex-1 min-h-0">
              <Suspense fallback={<PreviewSkeleton />}>
                <Show
                  when={content()}
                  fallback={
                    <div class="flex flex-col items-center justify-center h-full text-base-content/25 gap-2 rounded-lg border border-dashed border-base-300">
                      <svg class="w-9 h-9" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                          d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414A1 1 0 0119 9.414V19a2 2 0 01-2 2z" />
                      </svg>
                      <span class="text-xs">Click a file to preview</span>
                    </div>
                  }
                  keyed
                >
                  {(c) => (
                    <Show
                      when={c.isImage}
                      fallback={
                        <Show
                          when={isEditing()}
                          fallback={
                            <Show
                              when={isMarkdown()}
                              fallback={<HighlightedCode content={c.content as string} lang={fileExt()} />}
                            >
                              <MarkdownPreview content={c.content as string} />
                            </Show>
                          }
                        >
                          <EditPreview content={editContent()} onChange={setEditContent} />
                        </Show>
                      }
                    >
                      <ImagePreview src={`${BASE_URL}/api/file/download/${c.runId}/${c.itemId}`} />
                    </Show>
                  )}
                </Show>
              </Suspense>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}
