import { fetchFiles } from "../utils/api/file.api";

type FilesType = Awaited<ReturnType<typeof fetchFiles>>;
export type FileType = FilesType[number];


export type Attachment = {
  name: string,
  type: "text" | "image",
  file: File,
}
