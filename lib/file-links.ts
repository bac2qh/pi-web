import { isAutomaticTextPreviewPath } from "./file-types";

export const ASSISTANT_FILE_ACTION_CLASS = "assistant-file-action";
export const MAX_AUTOMATIC_FILE_CANDIDATE_LENGTH = 4_096;
const ASSISTANT_FILE_ACTION_HREF_PREFIX = "#assistant-file-action:";

export interface FileOpenOptions {
  automatic?: boolean;
  displayPath?: string;
  trigger?: HTMLElement | null;
}

export interface AutomaticFilePathMatch {
  start: number;
  end: number;
  displayText: string;
  filePath: string;
}

interface ResolveFileReferenceOptions {
  allowBareRelative?: boolean;
  allowWhitespace?: boolean;
  containAbsolute?: boolean;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizeFilePathSlashes(filePath: string): string {
  if (/^[a-zA-Z]:[\\/]/.test(filePath) || filePath.startsWith("\\\\")) {
    return filePath.replace(/\\/g, "/");
  }
  return filePath;
}

function stripLineSuffix(filePath: string): string {
  return filePath.replace(/:\d+(?::\d+)?$/, "");
}

function normalizeLocalPath(filePath: string): string {
  const normalized = normalizeFilePathSlashes(filePath);
  const isWindowsDrive = /^[a-zA-Z]:\//.test(normalized);
  const isUnc = normalized.startsWith("//");
  const leadingSlash = normalized.startsWith("/") && !isWindowsDrive && !isUnc;
  const parts: string[] = [];

  for (const part of normalized.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (parts.length > 0 && parts[parts.length - 1] !== "..") {
        parts.pop();
      } else if (!leadingSlash && !isWindowsDrive && !isUnc) {
        parts.push(part);
      }
      continue;
    }
    parts.push(part);
  }

  const joined = parts.join("/");
  if (isWindowsDrive) return joined;
  if (isUnc) return `//${joined}`;
  return leadingSlash ? `/${joined}` : joined;
}

export function isLocalFilePathInside(candidate: string, root: string): boolean {
  const normalizedCandidate = normalizeLocalPath(candidate).replace(/\/+$/, "");
  const normalizedRoot = normalizeLocalPath(root).replace(/\/+$/, "");
  const useCaseInsensitive =
    /^[a-zA-Z]:\//.test(normalizedCandidate)
    || /^[a-zA-Z]:\//.test(normalizedRoot)
    || normalizedCandidate.startsWith("//")
    || normalizedRoot.startsWith("//");
  const filePath = useCaseInsensitive ? normalizedCandidate.toLowerCase() : normalizedCandidate;
  const rootPath = useCaseInsensitive ? normalizedRoot.toLowerCase() : normalizedRoot;
  return filePath === rootPath || filePath.startsWith(`${rootPath}/`);
}

function looksLikeRelativeFileHref(href: string): boolean {
  if (href.startsWith("#") || href.startsWith("?")) return false;
  if (href.startsWith("./") || href.startsWith("../")) return true;
  if (href.includes("/")) return true;
  return /(^|\/)\.?[^/]+\.[^/.]+$/.test(href);
}

function fileUrlToPath(href: string): string | null {
  try {
    const url = new URL(href);
    if (url.protocol !== "file:") return null;
    const pathname = safeDecode(url.pathname);
    if (url.hostname) {
      return `//${url.hostname}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
    }
    if (/^\/[a-zA-Z]:\//.test(pathname)) return pathname.slice(1);
    return pathname;
  } catch {
    return null;
  }
}

function resolveFileReference(
  href: string | undefined,
  baseDir: string | undefined,
  relativeRoot: string | undefined,
  options: ResolveFileReferenceOptions = {},
): string | null {
  if (!href) return null;

  const cleanHref = href.split("#", 1)[0].split("?", 1)[0].trim();
  if (!cleanHref) return null;

  let candidate: string | null = null;
  let candidateKind: "absolute" | "relative" | null = null;
  const decodedHref = safeDecode(cleanHref);
  if (/[\u0000-\u001f\u007f]/.test(decodedHref)) return null;
  if (!options.allowWhitespace && /\s/.test(decodedHref)) return null;

  const isBackslashUncPath = decodedHref.startsWith("\\\\");
  const normalizedHref = normalizeFilePathSlashes(decodedHref);
  const lowerHref = normalizedHref.toLowerCase();

  if (lowerHref.startsWith("/api/") || lowerHref.startsWith("/_next/")) return null;
  if (!isBackslashUncPath && normalizedHref.startsWith("//")) return null;
  const hrefWithoutLineSuffix = stripLineSuffix(normalizedHref);
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/i.test(hrefWithoutLineSuffix) && !lowerHref.startsWith("file:") && !/^[a-zA-Z]:\//.test(normalizedHref)) {
    return null;
  }

  if (lowerHref.startsWith("file:")) {
    candidate = fileUrlToPath(normalizedHref);
    candidateKind = candidate ? "absolute" : null;
  } else if (/^[a-zA-Z]:\//.test(normalizedHref)) {
    candidate = normalizedHref;
    candidateKind = "absolute";
  } else if (normalizedHref.startsWith("/")) {
    candidate = normalizedHref;
    candidateKind = "absolute";
  } else if (baseDir && (options.allowBareRelative || looksLikeRelativeFileHref(normalizedHref))) {
    candidate = `${normalizeFilePathSlashes(baseDir).replace(/\/+$/, "")}/${normalizedHref}`;
    candidateKind = "relative";
  }

  if (!candidate) return null;

  const filePath = stripLineSuffix(normalizeLocalPath(candidate));
  if (relativeRoot && candidateKind === "relative" && !isLocalFilePathInside(filePath, relativeRoot)) return null;
  if (relativeRoot && candidateKind === "absolute" && options.containAbsolute && !isLocalFilePathInside(filePath, relativeRoot)) return null;
  return filePath;
}

export function resolveLocalFileHref(
  href: string | undefined,
  baseDir?: string,
  relativeRoot = baseDir,
): string | null {
  return resolveFileReference(href, baseDir, relativeRoot, { allowWhitespace: true });
}

function unwrapMatchingQuotes(candidate: string): string {
  const pairs: Readonly<Record<string, string>> = { '"': '"', "'": "'", "“": "”", "‘": "’" };
  const close = pairs[candidate[0]];
  return close && candidate.endsWith(close) ? candidate.slice(1, -1) : candidate;
}

function looksLikeHostPath(candidate: string): boolean {
  if (candidate.startsWith("./") || candidate.startsWith("../") || candidate.startsWith("/") || candidate.startsWith("\\")) return false;
  const slashIndex = candidate.search(/[\\/]/);
  if (slashIndex < 0) return false;
  const firstSegment = candidate.slice(0, slashIndex);
  return /^(?:www\.)?[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*\.[a-zA-Z]{2,}$/.test(firstSegment);
}

export function resolveAutomaticFilePath(
  candidate: string | undefined,
  workspace: string | undefined,
  options: { allowWhitespace?: boolean } = {},
): string | null {
  if (!candidate || !workspace || candidate.length > MAX_AUTOMATIC_FILE_CANDIDATE_LENGTH) return null;

  const unwrapped = unwrapMatchingQuotes(candidate.trim());
  if (!unwrapped || unwrapped.includes("?") || looksLikeHostPath(unwrapped)) return null;
  const fragmentIndex = unwrapped.indexOf("#");
  if (fragmentIndex >= 0 && !/^#L\d+(?:-L?\d+)?$/i.test(unwrapped.slice(fragmentIndex))) return null;

  const filePath = resolveFileReference(unwrapped, workspace, workspace, {
    allowBareRelative: true,
    allowWhitespace: options.allowWhitespace,
    containAbsolute: true,
  });
  return filePath && isAutomaticTextPreviewPath(filePath) ? filePath : null;
}

export function buildAssistantFileActionHref(filePath: string): string {
  return `${ASSISTANT_FILE_ACTION_HREF_PREFIX}${encodeURIComponent(filePath)}`;
}

export function resolveAssistantFileActionHref(
  href: string | undefined,
  workspace: string | undefined,
): string | null {
  if (!href?.startsWith(ASSISTANT_FILE_ACTION_HREF_PREFIX) || !workspace) return null;
  const decodedPath = safeDecode(href.slice(ASSISTANT_FILE_ACTION_HREF_PREFIX.length));
  if (!decodedPath || decodedPath.length > MAX_AUTOMATIC_FILE_CANDIDATE_LENGTH) return null;
  const normalizedPath = normalizeLocalPath(decodedPath);
  const isAbsolute = normalizedPath.startsWith("/") || /^[a-zA-Z]:\//.test(normalizedPath);
  if (!isAbsolute || !isLocalFilePathInside(normalizedPath, workspace)) return null;
  return isAutomaticTextPreviewPath(normalizedPath) ? normalizedPath : null;
}

const QUOTE_PAIRS: Readonly<Record<string, string>> = { '"': '"', "'": "'", "“": "”", "‘": "’" };
const OPENING_PUNCTUATION = new Set(["(", "[", "{", "<"]);
const TRAILING_PUNCTUATION = new Set([".", ",", ";", ":", "!", "?", ")", "]", "}", ">", '"', "'", "”", "’", "…"]);
const UNQUOTED_PATH_PROSE_BOUNDARIES = new Set([
  "after", "alongside", "and", "at", "before", "beside", "but", "by", "followed",
  "from", "in", "inside", "into", "near", "next", "on", "or", "outside", "over",
  "then", "through", "to", "under", "versus", "via", "vs", "while",
]);

function isQuoteBoundary(text: string, index: number): boolean {
  if (!QUOTE_PAIRS[text[index]]) return false;
  if (index === 0) return true;
  const previous = text[index - 1];
  return /\s/.test(previous) || OPENING_PUNCTUATION.has(previous) || previous === ":" || previous === "=";
}

function findClosingQuote(text: string, start: number, close: string): number {
  for (let index = start + 1; index < text.length; index += 1) {
    if (text[index] === close) return index;
  }
  return -1;
}

function trimUnquotedToken(text: string, start: number, end: number): { start: number; end: number } {
  while (start < end && OPENING_PUNCTUATION.has(text[start])) start += 1;
  while (end > start && TRAILING_PUNCTUATION.has(text[end - 1])) end -= 1;
  return { start, end };
}

function hasTrailingProseBoundary(token: string): boolean {
  return token.length > 0 && TRAILING_PUNCTUATION.has(token[token.length - 1]);
}

function looksLikeUnquotedPathPrefix(token: string): boolean {
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(token) && !/^[a-zA-Z]:[\\/]/.test(token)) return false;
  if (!/[a-zA-Z]/.test(token) && !token.startsWith(".") && !token.startsWith("/") && !token.startsWith("\\")) return false;
  return token.includes("/") || token.includes("\\");
}

export function findAutomaticFilePathMatches(
  text: string,
  workspace: string | undefined,
): AutomaticFilePathMatch[] {
  if (!workspace || !text) return [];

  const matches: AutomaticFilePathMatch[] = [];
  let index = 0;
  let unresolvedSpaceDelimitedPath = false;
  while (index < text.length) {
    if (/\s/.test(text[index])) {
      if (text[index] === "\n" || text[index] === "\r") unresolvedSpaceDelimitedPath = false;
      index += 1;
      continue;
    }

    const quoteClose = isQuoteBoundary(text, index) ? QUOTE_PAIRS[text[index]] : undefined;
    if (quoteClose) {
      const closeIndex = findClosingQuote(text, index, quoteClose);
      if (closeIndex < 0) break;
      const start = index + 1;
      const end = closeIndex;
      const displayText = text.slice(start, end);
      const filePath = resolveAutomaticFilePath(displayText, workspace, { allowWhitespace: true });
      if (filePath) matches.push({ start, end, displayText, filePath });
      unresolvedSpaceDelimitedPath = false;
      index = closeIndex + 1;
      continue;
    }

    let tokenEnd = index + 1;
    while (tokenEnd < text.length && !/\s/.test(text[tokenEnd]) && !isQuoteBoundary(text, tokenEnd)) {
      tokenEnd += 1;
    }
    const rawToken = text.slice(index, tokenEnd);
    const bounds = trimUnquotedToken(text, index, tokenEnd);
    const displayText = text.slice(bounds.start, bounds.end);
    const filePath = resolveAutomaticFilePath(displayText, workspace);
    if (filePath && !unresolvedSpaceDelimitedPath) {
      matches.push({ ...bounds, displayText, filePath });
    }

    if (filePath) {
      // A candidate suppressed as the suffix of an unquoted whitespace path
      // does not itself prove a new boundary. Keep suppressing until explicit
      // punctuation or a prose connector separates the next candidate.
      if (unresolvedSpaceDelimitedPath && hasTrailingProseBoundary(rawToken)) {
        unresolvedSpaceDelimitedPath = false;
      }
    } else if (looksLikeUnquotedPathPrefix(displayText) && !hasTrailingProseBoundary(rawToken)) {
      unresolvedSpaceDelimitedPath = true;
    } else if (hasTrailingProseBoundary(rawToken)) {
      unresolvedSpaceDelimitedPath = false;
    } else if (
      unresolvedSpaceDelimitedPath
      && displayText === displayText.toLowerCase()
      && UNQUOTED_PATH_PROSE_BOUNDARIES.has(displayText)
    ) {
      // Keep suppressing any length of a plausible whitespace-bearing path,
      // but recover at an explicit lowercase prose connector before a later
      // independent candidate. Ambiguous text intentionally favors inertia.
      unresolvedSpaceDelimitedPath = false;
    }
    index = tokenEnd;
  }

  return matches;
}
