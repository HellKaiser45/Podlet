import { api } from "./share.api";

type FileItem = Awaited<ReturnType<typeof fetchFiles>>[number];
type FilesByOrigin = Record<"workspace" | "artifact", FileItem[]>;

export async function fetchFiles(runId: string) {
  const { data, error } = await api.file.all({ runid: runId }).get();
  if (error || !data) return [];
  return data;
}

export function groupFilesByOrigin(files: FileItem[]): FilesByOrigin {
  return files.reduce<FilesByOrigin>(
    (acc, file) => {
      if (file.vpath.startsWith("workspace://")) {
        acc.workspace.push(file);
      } else if (file.vpath.startsWith("artifacts://")) {
        acc.artifact.push(file);
      }
      return acc;
    },
    { workspace: [], artifact: [] }
  );
}

export async function fetchFileContent(
  runId: string,
  fileId: string
): Promise<string> {
  const { data, error } = await api
    .file({ runid: runId })({ fileid: fileId })
    .get();
  if (error || !data) return "";
  return data;
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
