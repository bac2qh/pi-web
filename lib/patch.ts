export const PATCH_CONTEXT_LINES = 3;

const MAX_PARSED_PATCH_CHARS = 2 * 1024 * 1024;
const MAX_PARSED_PATCH_LINES = 40_000;
const MAX_INTRALINE_LINE_CHARS = 2_000;
const PATCH_FILE_SEPARATOR = "=".repeat(67);

export interface DiffTextRange {
  start: number;
  end: number;
}

export interface UnifiedDiffContextRow {
  type: "context";
  oldLineNo: number;
  newLineNo: number;
  text: string;
  emphasis?: undefined;
}

export interface UnifiedDiffRemovedRow {
  type: "removed";
  oldLineNo: number;
  newLineNo: null;
  text: string;
  emphasis?: DiffTextRange;
}

export interface UnifiedDiffAddedRow {
  type: "added";
  oldLineNo: null;
  newLineNo: number;
  text: string;
  emphasis?: DiffTextRange;
}

export interface UnifiedDiffNoNewlineRow {
  type: "no-newline";
  oldLineNo: null;
  newLineNo: null;
  text: string;
}

export interface UnifiedDiffOmissionRow {
  type: "omission";
  oldLineNo: number;
  newLineNo: number;
  count: number;
}

export type UnifiedDiffCodeRow =
  | UnifiedDiffContextRow
  | UnifiedDiffRemovedRow
  | UnifiedDiffAddedRow;

export type UnifiedDiffRow =
  | UnifiedDiffCodeRow
  | UnifiedDiffNoNewlineRow
  | UnifiedDiffOmissionRow;

export interface UnifiedDiffHunk {
  header: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  /** Every factual row supplied by the hunk, retained for truthful old/new syntax projections. */
  fullRows: UnifiedDiffSourceRow[];
  /** Change-focused presentation rows with distant context represented as omissions. */
  rows: UnifiedDiffRow[];
}

export interface UnifiedDiffFile {
  oldPath?: string;
  newPath?: string;
  additions: number;
  deletions: number;
  hunks: UnifiedDiffHunk[];
}

export type UnifiedDiffSourceRow = Exclude<UnifiedDiffRow, UnifiedDiffOmissionRow>;

interface PendingHunk {
  header: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  oldLineNo: number;
  newLineNo: number;
  oldConsumed: number;
  newConsumed: number;
  rows: UnifiedDiffSourceRow[];
}

interface GitFileMetadata {
  index?: { oldHash: string; newHash: string; mode?: string };
  newFileMode?: string;
  deletedFileMode?: string;
  oldMode?: string;
  newMode?: string;
}

type ParsedGitMetadata =
  | { kind: "index"; oldHash: string; newHash: string; mode?: string }
  | { kind: "new file mode" | "deleted file mode" | "old mode" | "new mode"; mode: string };

type PendingFilePreamble =
  | {
    kind: "git";
    oldPath: string;
    newPath: string;
    metadata: GitFileMetadata;
  }
  | { kind: "index"; path: string; separatorSeen: boolean }
  | { kind: "separator" };

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?:.*)$/;

export function parseUnifiedPatch(text: string): UnifiedDiffFile[] | null {
  if (!text || text.length > MAX_PARSED_PATCH_CHARS) return null;

  const lines = text.split(/\r?\n/);
  if (lines.length > MAX_PARSED_PATCH_LINES) return null;

  const files: UnifiedDiffFile[] = [];
  let currentFile: UnifiedDiffFile | null = null;
  let currentHunk: PendingHunk | null = null;
  let pendingOldPath: string | undefined;
  let pendingFilePreamble: PendingFilePreamble | null = null;
  let invalid = false;

  const hunkIsComplete = (hunk: PendingHunk) => (
    hunk.oldConsumed === hunk.oldCount && hunk.newConsumed === hunk.newCount
  );

  const finishHunk = () => {
    if (!currentHunk) return true;
    if (!currentFile || !hunkIsComplete(currentHunk)) return false;

    if (!hasStandardChangeOrder(currentHunk.rows)) return false;
    const decoratedRows = decorateReliableIntralineChanges(currentHunk.rows);
    currentFile.hunks.push({
      header: currentHunk.header,
      oldStart: currentHunk.oldStart,
      oldCount: currentHunk.oldCount,
      newStart: currentHunk.newStart,
      newCount: currentHunk.newCount,
      fullRows: decoratedRows,
      rows: trimHunkContext(decoratedRows),
    });
    currentFile.additions += decoratedRows.filter((row) => row.type === "added").length;
    currentFile.deletions += decoratedRows.filter((row) => row.type === "removed").length;
    currentHunk = null;
    return true;
  };

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    const isTerminalSplitLine = line === "" && lineIndex === lines.length - 1;

    if (currentHunk) {
      if (line.startsWith("\\ ")) {
        const previous = currentHunk.rows.at(-1);
        if (!previous || previous.type === "no-newline") {
          invalid = true;
          break;
        }
        currentHunk.rows.push({
          type: "no-newline",
          oldLineNo: null,
          newLineNo: null,
          text: line,
        });
        continue;
      }

      if (!hunkIsComplete(currentHunk)) {
        const prefix = line[0];
        const content = line.slice(1);
        if (prefix === " ") {
          currentHunk.rows.push({
            type: "context",
            oldLineNo: currentHunk.oldLineNo++,
            newLineNo: currentHunk.newLineNo++,
            text: content,
          });
          currentHunk.oldConsumed += 1;
          currentHunk.newConsumed += 1;
        } else if (prefix === "-") {
          currentHunk.rows.push({
            type: "removed",
            oldLineNo: currentHunk.oldLineNo++,
            newLineNo: null,
            text: content,
          });
          currentHunk.oldConsumed += 1;
        } else if (prefix === "+") {
          currentHunk.rows.push({
            type: "added",
            oldLineNo: null,
            newLineNo: currentHunk.newLineNo++,
            text: content,
          });
          currentHunk.newConsumed += 1;
        } else {
          invalid = true;
          break;
        }

        if (
          currentHunk.oldConsumed > currentHunk.oldCount
          || currentHunk.newConsumed > currentHunk.newCount
        ) {
          invalid = true;
          break;
        }
        continue;
      }

      if (!finishHunk()) {
        invalid = true;
        break;
      }
    }

    if (isTerminalSplitLine || line === "") continue;

    const gitHeader = parseGitFileHeader(line);
    if (line.startsWith("diff --git ")) {
      if (!gitHeader || pendingOldPath !== undefined || pendingFilePreamble) {
        invalid = true;
        break;
      }
      currentFile = null;
      pendingFilePreamble = {
        kind: "git",
        oldPath: gitHeader.oldPath,
        newPath: gitHeader.newPath,
        metadata: {},
      };
      continue;
    }

    if (line.startsWith("Index: ")) {
      if (!isSafeMetadataPath(line.slice(7)) || pendingOldPath !== undefined || pendingFilePreamble) {
        invalid = true;
        break;
      }
      currentFile = null;
      pendingFilePreamble = { kind: "index", path: line.slice(7), separatorSeen: false };
      continue;
    }

    if (line === PATCH_FILE_SEPARATOR) {
      if (pendingOldPath !== undefined) {
        invalid = true;
        break;
      }
      if (pendingFilePreamble?.kind === "index" && !pendingFilePreamble.separatorSeen) {
        pendingFilePreamble.separatorSeen = true;
      } else if (!pendingFilePreamble) {
        currentFile = null;
        pendingFilePreamble = { kind: "separator" };
      } else {
        invalid = true;
        break;
      }
      continue;
    }

    const gitMetadata = parseGitMetadata(line);
    if (gitMetadata) {
      if (
        pendingOldPath !== undefined
        || pendingFilePreamble?.kind !== "git"
        || !addGitMetadata(pendingFilePreamble.metadata, gitMetadata)
      ) {
        invalid = true;
        break;
      }
      continue;
    }

    if (line.startsWith("--- ")) {
      if (
        pendingOldPath !== undefined
        || (pendingFilePreamble?.kind === "index" && !pendingFilePreamble.separatorSeen)
      ) {
        invalid = true;
        break;
      }
      const oldPath = cleanPatchPath(line.slice(4));
      if (!isSafeMetadataPath(oldPath)) {
        invalid = true;
        break;
      }
      currentFile = null;
      pendingOldPath = oldPath;
      continue;
    }

    if (line.startsWith("+++ ")) {
      if (pendingOldPath === undefined) {
        invalid = true;
        break;
      }
      const newPath = cleanPatchPath(line.slice(4));
      if (
        !isSafeMetadataPath(newPath)
        || (pendingFilePreamble?.kind === "git"
          && !gitHeadersMatchPreamble(pendingFilePreamble, pendingOldPath, newPath))
        || (pendingFilePreamble?.kind === "index"
          && !indexHeadersMatchPreamble(pendingFilePreamble, pendingOldPath, newPath))
      ) {
        invalid = true;
        break;
      }
      currentFile = {
        oldPath: pendingOldPath,
        newPath,
        additions: 0,
        deletions: 0,
        hunks: [],
      };
      pendingOldPath = undefined;
      pendingFilePreamble = null;
      files.push(currentFile);
      continue;
    }

    const hunkMatch = line.match(HUNK_HEADER);
    if (hunkMatch) {
      if (pendingOldPath !== undefined || pendingFilePreamble || (!currentFile && files.length > 0)) {
        invalid = true;
        break;
      }
      const oldStart = Number(hunkMatch[1]);
      const oldCount = hunkMatch[2] === undefined ? 1 : Number(hunkMatch[2]);
      const newStart = Number(hunkMatch[3]);
      const newCount = hunkMatch[4] === undefined ? 1 : Number(hunkMatch[4]);
      if (!isSafeHunkRange(oldStart, oldCount) || !isSafeHunkRange(newStart, newCount)) {
        invalid = true;
        break;
      }
      if (!currentFile) {
        currentFile = { additions: 0, deletions: 0, hunks: [] };
        files.push(currentFile);
      }
      currentHunk = {
        header: line,
        oldStart,
        oldCount,
        newStart,
        newCount,
        oldLineNo: oldStart,
        newLineNo: newStart,
        oldConsumed: 0,
        newConsumed: 0,
        rows: [],
      };
      continue;
    }

    invalid = true;
    break;
  }

  if (!invalid && !finishHunk()) invalid = true;
  if (invalid || pendingOldPath !== undefined || pendingFilePreamble) return null;
  if (files.length === 0) return null;
  if (files.some((file) => file.hunks.length === 0 || file.additions + file.deletions === 0)) return null;

  return files;
}

export function getUnifiedDiffFileDisplayPath(file: Pick<UnifiedDiffFile, "oldPath" | "newPath">): string {
  const oldPath = normalizeDisplayPath(file.oldPath);
  const newPath = normalizeDisplayPath(file.newPath);
  if (oldPath && newPath && oldPath !== newPath && oldPath !== "/dev/null" && newPath !== "/dev/null") {
    return `${oldPath} → ${newPath}`;
  }
  if (newPath && newPath !== "/dev/null") return newPath;
  if (oldPath && oldPath !== "/dev/null") return oldPath;
  return newPath ?? oldPath ?? "Changed file";
}

function trimHunkContext(rows: UnifiedDiffSourceRow[]): UnifiedDiffRow[] {
  const visible = rows.map((row) => row.type !== "context");
  rows.forEach((row, index) => {
    if (row.type === "no-newline" && index > 0) visible[index - 1] = true;
  });

  rows.forEach((row, index) => {
    if (row.type !== "removed" && row.type !== "added") return;

    for (const direction of [-1, 1] as const) {
      let contextCount = 0;
      for (let candidate = index + direction; candidate >= 0 && candidate < rows.length; candidate += direction) {
        const candidateRow = rows[candidate];
        if (candidateRow.type === "removed" || candidateRow.type === "added") break;
        visible[candidate] = true;
        if (candidateRow.type === "context") {
          contextCount += 1;
          if (contextCount === PATCH_CONTEXT_LINES) break;
        }
      }
    }
  });

  const trimmed: UnifiedDiffRow[] = [];
  for (let index = 0; index < rows.length;) {
    if (visible[index]) {
      trimmed.push(rows[index]);
      index += 1;
      continue;
    }

    const first = rows[index];
    if (first.type !== "context") {
      trimmed.push(first);
      index += 1;
      continue;
    }

    let count = 0;
    while (index < rows.length && !visible[index] && rows[index].type === "context") {
      count += 1;
      index += 1;
    }
    trimmed.push({
      type: "omission",
      oldLineNo: first.oldLineNo,
      newLineNo: first.newLineNo,
      count,
    });
  }
  return trimmed;
}

function hasStandardChangeOrder(rows: UnifiedDiffSourceRow[]): boolean {
  let sawAdded = false;
  for (const row of rows) {
    if (row.type === "context") {
      sawAdded = false;
      continue;
    }
    if (row.type === "added") sawAdded = true;
    if (row.type === "removed" && sawAdded) return false;
  }
  return true;
}

function decorateReliableIntralineChanges(rows: UnifiedDiffSourceRow[]): UnifiedDiffSourceRow[] {
  const decorated = rows.map((row) => ({ ...row })) as UnifiedDiffSourceRow[];

  for (let start = 0; start < rows.length;) {
    if (rows[start].type === "context") {
      start += 1;
      continue;
    }

    let end = start + 1;
    while (end < rows.length && rows[end].type !== "context") end += 1;

    const removedIndices: number[] = [];
    const addedIndices: number[] = [];
    for (let index = start; index < end; index++) {
      if (rows[index].type === "removed") removedIndices.push(index);
      if (rows[index].type === "added") addedIndices.push(index);
    }

    // A one-to-one run is the only correspondence proved by unified-diff
    // structure alone. Multi-row runs can contain edits plus reordering, so
    // positional pairing would invent a relationship the patch does not state.
    if (removedIndices.length === 1 && addedIndices.length === 1) {
      const removedIndex = removedIndices[0];
      const addedIndex = addedIndices[0];
      const removed = rows[removedIndex] as UnifiedDiffRemovedRow;
      const added = rows[addedIndex] as UnifiedDiffAddedRow;
      const ranges = getReliableChangedRanges(removed.text, added.text);
      if (ranges) {
        decorated[removedIndex] = { ...removed, ...(ranges.removed.start < ranges.removed.end ? { emphasis: ranges.removed } : {}) };
        decorated[addedIndex] = { ...added, ...(ranges.added.start < ranges.added.end ? { emphasis: ranges.added } : {}) };
      }
    }

    start = end;
  }

  return decorated;
}

function getReliableChangedRanges(oldText: string, newText: string): {
  removed: DiffTextRange;
  added: DiffTextRange;
} | null {
  if (
    oldText === newText
    || oldText.length > MAX_INTRALINE_LINE_CHARS
    || newText.length > MAX_INTRALINE_LINE_CHARS
  ) return null;

  let prefix = 0;
  const sharedLimit = Math.min(oldText.length, newText.length);
  while (prefix < sharedLimit && oldText[prefix] === newText[prefix]) prefix += 1;

  let suffix = 0;
  while (
    suffix < oldText.length - prefix
    && suffix < newText.length - prefix
    && oldText[oldText.length - 1 - suffix] === newText[newText.length - 1 - suffix]
  ) suffix += 1;

  const oldRange = avoidSplitSurrogatePair(oldText, prefix, oldText.length - suffix);
  const newRange = avoidSplitSurrogatePair(newText, prefix, newText.length - suffix);
  const sharedText = oldText.slice(0, oldRange.start) + oldText.slice(oldRange.end);
  const sharedNonWhitespace = sharedText.replace(/\s/g, "").length;
  const shorterLength = Math.min(oldText.length, newText.length);
  const sharedRatio = shorterLength === 0 ? 0 : (prefix + suffix) / shorterLength;
  if (sharedNonWhitespace < 2 || sharedRatio < 0.2) return null;

  return {
    removed: oldRange,
    added: newRange,
  };
}

function isSafeHunkRange(start: number, count: number): boolean {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(count) || start < 0 || count < 0) return false;
  if (count > MAX_PARSED_PATCH_LINES || (count > 0 && start === 0)) return false;
  return count === 0 || start <= Number.MAX_SAFE_INTEGER - (count - 1);
}

function parseGitFileHeader(line: string): { oldPath: string; newPath: string } | null {
  const match = line.match(/^diff --git (a\/\S+) (b\/\S+)$/);
  if (!match) return null;
  return { oldPath: match[1], newPath: match[2] };
}

function parseGitMetadata(line: string): ParsedGitMetadata | null {
  const index = line.match(/^index ([0-9a-fA-F]{4,64})\.\.([0-9a-fA-F]{4,64})(?: ([0-7]{6}))?$/);
  if (index) {
    return {
      kind: "index",
      oldHash: index[1],
      newHash: index[2],
      ...(index[3] ? { mode: index[3] } : {}),
    };
  }

  const fileMode = line.match(/^(new file mode|deleted file mode|old mode|new mode) ([0-7]{6})$/);
  if (fileMode) {
    return {
      kind: fileMode[1] as Exclude<ParsedGitMetadata["kind"], "index">,
      mode: fileMode[2],
    };
  }
  return null;
}

function addGitMetadata(metadata: GitFileMetadata, item: ParsedGitMetadata): boolean {
  if (item.kind === "index") {
    if (metadata.index) return false;
    metadata.index = {
      oldHash: item.oldHash,
      newHash: item.newHash,
      ...(item.mode ? { mode: item.mode } : {}),
    };
    return true;
  }

  if (item.kind === "new file mode") {
    if (metadata.newFileMode || metadata.deletedFileMode || metadata.oldMode || metadata.newMode) return false;
    metadata.newFileMode = item.mode;
    return true;
  }
  if (item.kind === "deleted file mode") {
    if (metadata.deletedFileMode || metadata.newFileMode || metadata.oldMode || metadata.newMode) return false;
    metadata.deletedFileMode = item.mode;
    return true;
  }
  if (item.kind === "old mode") {
    if (metadata.oldMode || metadata.newMode || metadata.newFileMode || metadata.deletedFileMode) return false;
    metadata.oldMode = item.mode;
    return true;
  }
  if (!metadata.oldMode || metadata.newMode || metadata.newFileMode || metadata.deletedFileMode) return false;
  metadata.newMode = item.mode;
  return true;
}

function gitHeadersMatchPreamble(
  preamble: Extract<PendingFilePreamble, { kind: "git" }>,
  oldPath: string,
  newPath: string,
): boolean {
  if (
    oldPath === "/dev/null" && newPath === "/dev/null"
    || (oldPath !== preamble.oldPath && oldPath !== "/dev/null")
    || (newPath !== preamble.newPath && newPath !== "/dev/null")
  ) return false;

  const creation = oldPath === "/dev/null";
  const deletion = newPath === "/dev/null";
  const metadata = preamble.metadata;
  if (metadata.newFileMode && !creation) return false;
  if (metadata.deletedFileMode && !deletion) return false;
  if ((metadata.oldMode || metadata.newMode) && (creation || deletion)) return false;
  if ((metadata.oldMode === undefined) !== (metadata.newMode === undefined)) return false;
  if (metadata.oldMode && metadata.oldMode === metadata.newMode) return false;

  if (metadata.index) {
    if (metadata.index.mode && (metadata.newFileMode || metadata.deletedFileMode || metadata.oldMode)) return false;
    const oldIsZero = /^0+$/.test(metadata.index.oldHash);
    const newIsZero = /^0+$/.test(metadata.index.newHash);
    if (creation ? !oldIsZero || newIsZero : deletion ? oldIsZero || !newIsZero : oldIsZero || newIsZero) {
      return false;
    }
  }
  return true;
}

function indexHeadersMatchPreamble(
  preamble: Extract<PendingFilePreamble, { kind: "index" }>,
  oldPath: string,
  newPath: string,
): boolean {
  return oldPath !== "/dev/null" || newPath !== "/dev/null"
    ? (oldPath === preamble.path || oldPath === "/dev/null")
      && (newPath === preamble.path || newPath === "/dev/null")
    : false;
}

function isSafeMetadataPath(path: string): boolean {
  return path.length > 0 && !/[\u0000-\u001f\u007f]/.test(path);
}

function avoidSplitSurrogatePair(text: string, start: number, end: number): DiffTextRange {
  let safeStart = start;
  let safeEnd = end;
  if (isSurrogateBoundary(text, safeStart)) safeStart -= 1;
  if (isSurrogateBoundary(text, safeEnd)) safeEnd += 1;
  return { start: safeStart, end: safeEnd };
}

function isSurrogateBoundary(text: string, index: number): boolean {
  if (index <= 0 || index >= text.length) return false;
  const before = text.charCodeAt(index - 1);
  const after = text.charCodeAt(index);
  return before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff;
}

function cleanPatchPath(path: string): string {
  return path.split("\t")[0].trim();
}

function normalizeDisplayPath(path: string | undefined): string | undefined {
  if (!path) return undefined;
  if (path === "/dev/null") return path;
  if ((path.startsWith("a/") || path.startsWith("b/")) && path.length > 2) return path.slice(2);
  return path;
}
