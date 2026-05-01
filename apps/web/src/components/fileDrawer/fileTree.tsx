import { createSignal, createMemo, For, Show } from "solid-js";
import { buildFileTree, searchTree, countFiles, type TreeNode } from "../../utils/file-tree";

type FileItem = { name: string; vpath: string; id: string; type: 'text' | 'image' };

type FileTreeProps = {
  files: FileItem[];
  selectedId: string | null;
  onSelectFile: (file: FileItem) => void;
  onDownloadFile: (file: { id: string; name: string }) => void;
  onDownloadFolder: (folder: { fullPath: string; name: string }) => void;
};

function FileIconSvg() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" class="shrink-0">
      <path d="M7 18H17V16H7V18Z" fill="currentColor" />
      <path d="M17 14H7V12H17V14Z" fill="currentColor" />
      <path d="M7 10H11V8H7V10Z" fill="currentColor" />
      <path fill-rule="evenodd" clip-rule="evenodd" d="M6 2C4.34315 2 3 3.34315 3 5V19C3 20.6569 4.34315 22 6 22H18C19.6569 22 21 20.6569 21 19V9C21 5.13401 17.866 2 14 2H6ZM6 4H13V9H19V19C19 19.5523 18.5523 20 18 20H6C5.44772 20 5 19.5523 5 19V5C5 4.44772 5.44772 4 6 4ZM15 4.10002C16.6113 4.4271 17.9413 5.52906 18.584 7H15V4.10002Z" fill="currentColor" />
    </svg>
  );
}

function ImageIconSvg() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" class="shrink-0">
      <path fill-rule="evenodd" clip-rule="evenodd" d="M7 7C5.34315 7 4 8.34315 4 10C4 11.6569 5.34315 13 7 13C8.65685 13 10 11.6569 10 10C10 8.34315 8.65685 7 7 7ZM6 10C6 9.44772 6.44772 9 7 9C7.55228 9 8 9.44772 8 10C8 10.5523 7.55228 11 7 11C6.44772 11 6 10.5523 6 10Z" fill="currentColor" />
      <path fill-rule="evenodd" clip-rule="evenodd" d="M3 3C1.34315 3 0 4.34315 0 6V18C0 19.6569 1.34315 21 3 21H21C22.6569 21 24 19.6569 24 18V6C24 4.34315 22.6569 3 21 3H3ZM21 5H3C2.44772 5 2 5.44772 2 6V18C2 18.5523 2.44772 19 3 19H7.31374L14.1924 12.1214C15.364 10.9498 17.2635 10.9498 18.435 12.1214L22 15.6863V6C22 5.44772 21.5523 5 21 5ZM21 19H10.1422L15.6066 13.5356C15.9971 13.145 16.6303 13.145 17.0208 13.5356L21.907 18.4217C21.7479 18.7633 21.4016 19 21 19Z" fill="currentColor" />
    </svg>
  );
}

function FolderIconSvg() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" class="shrink-0">
      <path d="M2 6C2 4.89543 2.89543 4 4 4H9L11 6H20C21.1046 6 22 6.89543 22 8V18C22 19.1046 21.1046 20 20 20H4C2.89543 20 2 19.1046 2 18V6Z" fill="currentColor" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="shrink-0">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" stroke-linecap="round" stroke-linejoin="round" />
      <polyline points="7 10 12 15 17 10" stroke-linecap="round" stroke-linejoin="round" />
      <line x1="12" y1="15" x2="12" y2="3" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  );
}

function TreeNodeItem(props: {
  node: TreeNode;
  depth: number;
  selectedId: string | null;
  expandedFolders: Set<string>;
  onSelectFile: (file: FileItem) => void;
  onDownloadFile: (file: { id: string; name: string }) => void;
  onDownloadFolder: (folder: { fullPath: string; name: string }) => void;
  onToggleFolder: (path: string) => void;
}) {
  const isExpanded = () => props.expandedFolders.has(props.node.fullPath);
  const isSelected = () => props.node.type === 'file' && props.node.id === props.selectedId;

  return (
    <>
      <div
        class="group flex items-center gap-1.5 py-1 px-2 cursor-pointer transition-colors text-xs"
        style={{ "padding-left": `${props.depth * 16 + 8}px` }}
        classList={{
          "text-primary bg-primary/10 border-l-2 border-primary": isSelected(),
          "text-base-content/60 hover:bg-base-300/40": !isSelected(),
          "text-primary": props.node.type === 'folder' && isExpanded(),
        }}
        onClick={() => {
          if (props.node.type === 'folder') {
            props.onToggleFolder(props.node.fullPath);
          } else if (props.node.id) {
            props.onSelectFile({
              name: props.node.name,
              vpath: props.node.vpath,
              id: props.node.id,
              type: props.node.fileType ?? 'text',
            });
          }
        }}
      >
        <Show when={props.node.type === 'folder'}>
          <span class={`transition-transform duration-150 text-[10px] ${isExpanded() ? 'rotate-90' : ''}`} style={{ display: 'inline-block' }}>
            ▸
          </span>
          <FolderIconSvg />
          <span class="truncate flex-1">{props.node.name}</span>
          <span class="text-[9px] text-base-content/30 mr-1">{countFiles([props.node])}</span>
          <button
            class="opacity-0 group-hover:opacity-100 text-base-content/40 hover:text-primary transition-opacity"
            onClick={(e) => {
              e.stopPropagation();
              props.onDownloadFolder({ fullPath: props.node.fullPath, name: props.node.name });
            }}
            title="Download folder as ZIP"
          >
            <DownloadIcon />
          </button>
        </Show>

        <Show when={props.node.type === 'file'}>
          <span class="w-3 shrink-0" />
          <Show when={props.node.fileType === 'image'} fallback={<FileIconSvg />}>
            <ImageIconSvg />
          </Show>
          <span class="truncate flex-1">{props.node.name}</span>
          <button
            class="opacity-0 group-hover:opacity-100 text-base-content/40 hover:text-primary transition-opacity"
            onClick={(e) => {
              e.stopPropagation();
              if (props.node.id) props.onDownloadFile({ id: props.node.id, name: props.node.name });
            }}
            title="Download file"
          >
            <DownloadIcon />
          </button>
        </Show>
      </div>

      <Show when={props.node.type === 'folder' && isExpanded()}>
        <For each={props.node.children}>
          {(child) => (
            <TreeNodeItem
              node={child}
              depth={props.depth + 1}
              selectedId={props.selectedId}
              expandedFolders={props.expandedFolders}
              onSelectFile={props.onSelectFile}
              onDownloadFile={props.onDownloadFile}
              onDownloadFolder={props.onDownloadFolder}
              onToggleFolder={props.onToggleFolder}
            />
          )}
        </For>
      </Show>
    </>
  );
}

export default function FileTree(props: FileTreeProps) {
  const [searchQuery, setSearchQuery] = createSignal("");
  const [expandedFolders, setExpandedFolders] = createSignal<Set<string>>(new Set());

  const tree = createMemo(() => buildFileTree(props.files));
  const filteredTree = createMemo(() => searchTree(tree(), searchQuery()));

  const toggleFolder = (path: string) => {
    setExpandedFolders(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const expandAll = () => {
    const allPaths = new Set<string>();
    const collect = (nodes: TreeNode[]) => {
      for (const n of nodes) {
        if (n.type === 'folder') {
          allPaths.add(n.fullPath);
          collect(n.children);
        }
      }
    };
    collect(tree());
    setExpandedFolders(allPaths);
  };

  const collapseAll = () => setExpandedFolders(new Set<string>());

  return (
    <div class="flex flex-col h-full">
      <div class="flex items-center gap-1 px-2 pb-2">
        <input
          type="text"
          placeholder="search files..."
          value={searchQuery()}
          onInput={(e) => setSearchQuery(e.currentTarget.value)}
          class="flex-1 bg-base-300/40 border border-base-300 rounded-sm px-2 py-1 text-[10px] font-mono text-base-content/70 placeholder:text-base-content/25 outline-none focus:border-primary/50 transition-colors"
        />
        <button
          class="text-[9px] font-mono text-base-content/30 hover:text-primary transition-colors px-1"
          onClick={expandAll}
          title="Expand all"
        >
          +++
        </button>
        <button
          class="text-[9px] font-mono text-base-content/30 hover:text-primary transition-colors px-1"
          onClick={collapseAll}
          title="Collapse all"
        >
          ---
        </button>
      </div>

      <div class="flex-1 overflow-y-auto overflow-x-hidden">
        <Show
          when={filteredTree().length > 0}
          fallback={
            <div class="text-[10px] font-mono text-base-content/25 text-center py-4">
              {searchQuery() ? 'no matches' : 'empty'}
            </div>
          }
        >
          <For each={filteredTree()}>
            {(node) => (
              <TreeNodeItem
                node={node}
                depth={0}
                selectedId={props.selectedId}
                expandedFolders={expandedFolders()}
                onSelectFile={props.onSelectFile}
                onDownloadFile={props.onDownloadFile}
                onDownloadFolder={props.onDownloadFolder}
                onToggleFolder={toggleFolder}
              />
            )}
          </For>
        </Show>
      </div>
    </div>
  );
}
