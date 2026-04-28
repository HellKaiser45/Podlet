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

  const handleDownloadFolder = async (folder: { vpath: string; name: string }) => {
    if (!runId()) return;
    const scheme = activeMenu() === 'workspace' ? '/home/hellkaiser/.podlet/workspace/858d132d-4d20-47be-8c99-8cf8de52e1db/' : '/home/hellkaiser/.podlet/artifacts/858d132d-4d20-47be-8c99-8cf8de52e1db/';
