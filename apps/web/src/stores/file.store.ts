

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
