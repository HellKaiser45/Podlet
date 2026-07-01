import { api, BASE_URL } from "./share.api";

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
  const res = await fetch(`${BASE_URL}/api/file/download/${runId}/${fileId}`);
  if (!res.ok) throw new Error('Failed to download file');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
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

export async function downloadFolder(
  runId: string,
  folderId: string,
  folderName: string
): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/file/download-zip/${runId}/${folderId}`);
  if (!res.ok) throw new Error('Failed to download folder');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${folderName}.zip`;
  a.click();
  URL.revokeObjectURL(url);
}
