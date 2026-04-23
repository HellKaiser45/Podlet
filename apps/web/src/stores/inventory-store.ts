import { api } from "../utils/api/share.api";
import { createSignal } from "solid-js";

type hoveredItem = {
  type: "file" | "agent" | "model" | "mcp",
  id: string,
}

export const [hoveredItem, setHoveredItem] = createSignal<hoveredItem | null>(null)



export type Fileresponse = {
  name: string;
  vpath: string;
  id: string;
};

export function getFileScheme(vpath: string): "workspace" | "artifacts" {
  return vpath.startsWith("artifacts://") ? "artifacts" : "workspace";
}

export function getFileExt(name: string): string {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

export function getFileType(name: string, vpath: string): string {
  const ext = getFileExt(name);
  const scheme = getFileScheme(vpath);
  const map: Record<string, string> = {
    ts: "TypeScript/Source",
    tsx: "TypeScript/Component",
    js: "JavaScript/Source",
    jsx: "JavaScript/Component",
    json: "Data/JSON",
    md: "Document/Markdown",
    mdx: "Document/MDX",
    txt: "Document/Text",
    py: "Script/Python",
    html: "Markup/HTML",
    css: "Style/CSS",
    scss: "Style/SCSS",
    sh: "Script/Shell",
    bash: "Script/Bash",
    rs: "Systems/Rust",
    go: "Systems/Go",
    png: "Image/PNG",
    jpg: "Image/JPEG",
    jpeg: "Image/JPEG",
    gif: "Image/GIF",
    webp: "Image/WebP",
    svg: "Vector/SVG",
    yaml: "Config/YAML",
    yml: "Config/YAML",
    toml: "Config/TOML",
    sql: "Database/SQL",
    csv: "Data/CSV",
  };
  const typeStr = map[ext] ?? `File/${ext.toUpperCase() || "Unknown"}`;
  return scheme === "artifacts" ? `Artifact/${typeStr}` : typeStr;
}

export function getFileRarity(
  name: string,
  vpath: string
): { label: string; cls: string } {
  const ext = getFileExt(name);
  const scheme = getFileScheme(vpath);
  if (scheme === "artifacts")
    return { label: "ARTIFACT", cls: "text-primary" };
  if (["ts", "tsx", "rs", "go", "zig"].includes(ext))
    return { label: "RARE", cls: "text-secondary" };
  if (["js", "jsx", "py", "rb"].includes(ext))
    return { label: "UNCOMMON", cls: "text-accent" };
  return { label: "COMMON", cls: "text-base-content/40" };
}

// ─── API ──────────────────────────────────────────────────────────────────────

export async function fetchFiles(runId: string): Promise<Fileresponse[]> {
  const { data, error } = await api.file.all({ runid: runId }).get();
  if (error || !data) return [];
  return data as Fileresponse[];
}

export async function fetchFileContent(
  runId: string,
  fileId: string
): Promise<string> {
  const { data, error } = await api
    .file({ runid: runId })({ fileid: fileId })
    .get();
  if (error || !data) return "";
  return data as string;
}

export async function downloadFile(
  runId: string,
  fileId: string,
  fileName: string
): Promise<void> {
  const { data, error } = await api
    .file.download({ runid: runId })({ fileid: fileId })
    .get();
  if (error || !data) throw error;
  const url = URL.createObjectURL(data);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

export async function deleteFile(
  runId: string,
  fileId: string
): Promise<boolean> {
  const { error } = await api
    .file({ runid: runId })({ fileid: fileId })
    .delete();
  return !error;
}

export async function updateFileContent(
  runId: string,
  fileId: string,
  content: string
): Promise<boolean> {
  const { error } = await api
    .file({ runid: runId })({ fileid: fileId })
    .patch(content);
  return !error;
}
