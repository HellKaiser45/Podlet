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

export { getFileScheme, getFileExt, getFileType, getFileRarity } from "./file-utils";

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
