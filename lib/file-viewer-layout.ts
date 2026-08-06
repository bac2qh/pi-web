export const FILE_VIEWER_DIRECT_OPEN_MIN_WIDTH = 1_000;

export interface FileViewerExpansionState {
  manual: boolean;
  automaticNarrow: boolean;
  automaticNarrowSuppressed: boolean;
}

export interface FileOpenContextIdentity {
  sessionId: string | null;
  cwd: string | null;
}

export const INITIAL_FILE_VIEWER_EXPANSION: FileViewerExpansionState = {
  manual: false,
  automaticNarrow: false,
  automaticNarrowSuppressed: false,
};

export function isNarrowFileViewerWidth(width: number): boolean {
  return width < FILE_VIEWER_DIRECT_OPEN_MIN_WIDTH;
}

export function shouldConfirmAutomaticFileOpen(
  automaticFileAction: boolean,
  narrowViewport: boolean,
): boolean {
  return automaticFileAction && narrowViewport;
}

export function isFileViewerExpanded(state: FileViewerExpansionState): boolean {
  return state.manual || state.automaticNarrow;
}

export function isFileViewerExpandedForViewport(
  state: FileViewerExpansionState,
  narrowViewport: boolean,
  panelOpen: boolean,
): boolean {
  if (!panelOpen) return false;
  if (state.manual) return true;
  if (!narrowViewport) return false;
  return state.automaticNarrow || !state.automaticNarrowSuppressed;
}

function withExpansion(
  state: FileViewerExpansionState,
  changes: Partial<FileViewerExpansionState>,
): FileViewerExpansionState {
  const next = { ...state, ...changes };
  return next.manual === state.manual
    && next.automaticNarrow === state.automaticNarrow
    && next.automaticNarrowSuppressed === state.automaticNarrowSuppressed
    ? state
    : next;
}

export function fileViewerExpansionAfterOpen(
  state: FileViewerExpansionState,
  narrowViewport: boolean,
): FileViewerExpansionState {
  return withExpansion(state, {
    automaticNarrow: narrowViewport,
    automaticNarrowSuppressed: false,
  });
}

export function fileViewerExpansionAfterViewportChange(
  state: FileViewerExpansionState,
  narrowViewport: boolean,
  panelOpen: boolean,
): FileViewerExpansionState {
  if (!narrowViewport) return withExpansion(state, { automaticNarrow: false });
  if (!panelOpen || state.automaticNarrowSuppressed) return state;
  return withExpansion(state, { automaticNarrow: true });
}

export function fileViewerExpansionAfterToggle(
  state: FileViewerExpansionState,
  narrowViewport: boolean,
): FileViewerExpansionState {
  if (isFileViewerExpandedForViewport(state, narrowViewport, true)) {
    return {
      manual: false,
      automaticNarrow: false,
      automaticNarrowSuppressed: narrowViewport,
    };
  }
  return {
    manual: true,
    automaticNarrow: false,
    automaticNarrowSuppressed: false,
  };
}

export function fileViewerExpansionAfterFinalClose(): FileViewerExpansionState {
  return INITIAL_FILE_VIEWER_EXPANSION;
}

export function isSameFileOpenContext(
  captured: FileOpenContextIdentity,
  current: FileOpenContextIdentity,
): boolean {
  return captured.sessionId === current.sessionId && captured.cwd === current.cwd;
}
