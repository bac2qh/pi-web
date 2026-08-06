export const TEXT_PREVIEW_MAX_BYTES = 256 * 1024;
export const IMAGE_PREVIEW_MAX_BYTES = 10 * 1024 * 1024;
export const DOCX_PREVIEW_MAX_BYTES = 10 * 1024 * 1024;
export const TEXT_PREVIEW_TOO_LARGE_ERROR = "File too large for preview (>256KB)";
export const TEXT_PREVIEW_UNSUPPORTED_ERROR = "Unsupported or binary text file (NUL byte or invalid UTF-8)";

export type DocumentPreviewKind = "pdf" | "docx";
export type TextPreviewDecodeResult =
  | { ok: true; content: string }
  | { ok: false; kind: "too_large" | "unsupported"; error: string };

export const FILE_EXT_TO_LANGUAGE: Readonly<Record<string, string>> = {
  ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
  mjs: "javascript", cjs: "javascript", py: "python", rb: "ruby",
  go: "go", rs: "rust", java: "java", kt: "kotlin", swift: "swift",
  c: "c", cpp: "cpp", h: "c", hpp: "cpp", cs: "csharp",
  html: "html", htm: "html", css: "css", scss: "css", less: "css",
  json: "json", jsonl: "json", yaml: "yaml", yml: "yaml",
  toml: "toml", xml: "xml", md: "markdown", mdx: "markdown",
  sh: "bash", bash: "bash", zsh: "bash", fish: "bash",
  sql: "sql", graphql: "graphql", gql: "graphql",
  dockerfile: "dockerfile", tf: "hcl", hcl: "hcl",
  env: "bash", gitignore: "bash", txt: "text",
  pdf: "pdf", docx: "word",
};

const AUTOMATIC_TEXT_EXTENSIONS = new Set(
  Object.keys(FILE_EXT_TO_LANGUAGE).filter((ext) => ext !== "pdf" && ext !== "docx"),
);
const ESTABLISHED_TEXT_FILE_NAMES = new Set([
  "authors", "changelog", "changes", "contributing", "copying", "license", "licence",
  "notice", "readme", "security", "todo",
  "makefile", "gnumakefile", "justfile", "procfile",
  ".dockerignore", ".editorconfig", ".gitattributes", ".gitmodules", ".npmrc", ".nvmrc",
  ".prettierignore", ".stylelintignore", ".tool-versions", ".yarnrc",
  "cargo.lock", "gemfile", "go.mod", "go.sum", "rakefile", "yarn.lock",
]);

export const IMAGE_EXT_TO_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  ico: "image/x-icon",
  avif: "image/avif",
};

export const AUDIO_EXT_TO_MIME: Record<string, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  flac: "audio/flac",
  weba: "audio/webm",
  webm: "audio/webm",
};

export const DOCUMENT_EXT_TO_MIME: Record<DocumentPreviewKind, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

// Compound source names use an allow-list so arbitrary suffixes do not bypass
// the ordinary text-extension policy. Multiple labels cover names such as
// `.env.production.local` without treating `.env.com` as text.
const ESTABLISHED_TEXT_VARIANT_LABELS = new Set([
  "alpine", "amd64", "arm64", "ci", "debug", "defaults", "dev", "development",
  "dist", "example", "linux", "local", "prod", "production", "qa", "release",
  "sample", "staging", "template", "test", "testing", "ubuntu", "windows",
]);

function getBaseName(filePath: string): string {
  return filePath.replace(/\\/g, "/").split("/").pop() ?? "";
}

export function getFileExt(filePath: string): string {
  return getBaseName(filePath).toLowerCase().split(".").pop() ?? "";
}

export function getFileLanguage(filePath: string): string {
  const base = getBaseName(filePath).toLowerCase();
  if (base === "dockerfile" || base.startsWith("dockerfile.")) return "dockerfile";
  if (base === ".env" || base.startsWith(".env.")) return "bash";
  if (base === "makefile" || base === "gnumakefile") return "makefile";
  return FILE_EXT_TO_LANGUAGE[getFileExt(base)] ?? "text";
}

export function isAutomaticTextPreviewPath(filePath: string): boolean {
  const base = getBaseName(filePath).toLowerCase();
  if (!base) return false;
  if (ESTABLISHED_TEXT_FILE_NAMES.has(base)) return true;
  // A supported text/source extension is eligible regardless of its basename;
  // the compound-name allow-list below is only for otherwise unknown suffixes.
  if (AUTOMATIC_TEXT_EXTENSIONS.has(getFileExt(base))) return true;

  const variant = base.startsWith(".env.")
    ? base.slice(".env.".length)
    : base.startsWith("dockerfile.")
      ? base.slice("dockerfile.".length)
      : null;
  return variant !== null
    && variant.length > 0
    && variant.split(".").every((label) => ESTABLISHED_TEXT_VARIANT_LABELS.has(label));
}

export function decodeTextPreviewBytes(bytes: Uint8Array): TextPreviewDecodeResult {
  if (bytes.byteLength > TEXT_PREVIEW_MAX_BYTES) {
    return { ok: false, kind: "too_large", error: TEXT_PREVIEW_TOO_LARGE_ERROR };
  }
  if (bytes.includes(0)) {
    return { ok: false, kind: "unsupported", error: TEXT_PREVIEW_UNSUPPORTED_ERROR };
  }

  try {
    return { ok: true, content: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
  } catch {
    return { ok: false, kind: "unsupported", error: TEXT_PREVIEW_UNSUPPORTED_ERROR };
  }
}

export function getImageMime(filePath: string): string | null {
  return IMAGE_EXT_TO_MIME[getFileExt(filePath)] ?? null;
}

export function getAudioMime(filePath: string): string | null {
  return AUDIO_EXT_TO_MIME[getFileExt(filePath)] ?? null;
}

export function getDocumentMime(filePath: string): string | null {
  return DOCUMENT_EXT_TO_MIME[getFileExt(filePath) as DocumentPreviewKind] ?? null;
}

export function documentPreviewKind(filePath: string): DocumentPreviewKind | null {
  const ext = getFileExt(filePath);
  if (ext === "pdf" || ext === "docx") return ext;
  return null;
}

export function isImagePath(filePath: string): boolean {
  return getImageMime(filePath) !== null;
}

export function isAudioPath(filePath: string): boolean {
  return getAudioMime(filePath) !== null;
}

export function isDocumentPreviewPath(filePath: string): boolean {
  return documentPreviewKind(filePath) !== null;
}
