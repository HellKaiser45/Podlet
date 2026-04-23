import { createSignal } from "solid-js";
import type { Attachment } from "../types/files";



export const ALLOWED_MIME_TYPES = {
  image: ["image/png", "image/jpeg", "image/gif", "image/webp"],
  text: [
    "text/plain", "text/markdown", "text/csv", "text/html",
    "text/css", "text/javascript", "text/typescript",
    "application/json", "application/xml",
    "application/javascript", "application/typescript",
  ],
};

export const ALLOWED_EXTENSIONS = new Set([
  "js", "jsx", "ts", "tsx", "html", "css", "scss", "sass", "less",
  "py", "rb", "php", "go", "rs", "java", "kt", "swift", "cs",
  "lua", "sh", "bash", "zsh", "fish", "ps1",
  "json", "yaml", "yml", "toml", "env", "ini", "cfg",
  "xml", "csv", "sql",
  "md", "mdx", "txt", "rst",
  "c", "cpp", "h", "hpp", "zig", "ex", "exs", "erl",
  "r", "jl", "dart", "scala", "clj",
]);

export const [attachments, setAttachments] = createSignal<Attachment[]>([]);


export function processFile(files: File[]) {

  for (const file of files) {
    let filetype: "text" | "image" = "text"
    if (file.type.startsWith("image/")) filetype = "image"

    const newFile: Attachment = {
      name: file.name,
      type: filetype,
      file: file
    }

    if (attachments().some(a => a.name === file.name)) {
      setAttachments(prev => prev.filter(a => a.name !== file.name));
    }
    setAttachments(prev => [...prev, newFile]);
  }
}

export const removeAttachment = (name: string) =>
  setAttachments(prev => prev.filter(a => a.name !== name));

