import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function loadSubject() {
  return import("./file-viewer-layout.ts");
}

test("uses the exact 1000px direct-open breakpoint", async () => {
  const { isNarrowFileViewerWidth, shouldConfirmAutomaticFileOpen } = await loadSubject();

  assert.equal(isNarrowFileViewerWidth(1_000), false);
  assert.equal(isNarrowFileViewerWidth(999), true);
  assert.equal(isNarrowFileViewerWidth(641), true);
  assert.equal(isNarrowFileViewerWidth(640), true);
  assert.equal(isNarrowFileViewerWidth(375), true);
  assert.equal(shouldConfirmAutomaticFileOpen(true, isNarrowFileViewerWidth(1_000)), false);
  assert.equal(shouldConfirmAutomaticFileOpen(true, isNarrowFileViewerWidth(999)), true);
  assert.equal(shouldConfirmAutomaticFileOpen(false, isNarrowFileViewerWidth(999)), false);
});

test("automatic narrow expansion follows opens and responsive crossings", async () => {
  const {
    INITIAL_FILE_VIEWER_EXPANSION,
    fileViewerExpansionAfterOpen,
    fileViewerExpansionAfterViewportChange,
    isFileViewerExpanded,
    isFileViewerExpandedForViewport,
  } = await loadSubject();

  const desktopOpen = fileViewerExpansionAfterOpen(INITIAL_FILE_VIEWER_EXPANSION, false);
  assert.equal(isFileViewerExpanded(desktopOpen), false);
  assert.equal(isFileViewerExpandedForViewport(desktopOpen, true, true), true, "crossing narrow is effective before the synchronization effect");

  const crossedNarrow = fileViewerExpansionAfterViewportChange(desktopOpen, true, true);
  assert.deepEqual(crossedNarrow, {
    manual: false,
    automaticNarrow: true,
    automaticNarrowSuppressed: false,
  });
  assert.equal(isFileViewerExpanded(crossedNarrow), true);

  assert.equal(isFileViewerExpandedForViewport(crossedNarrow, false, true), false, "automatic expansion clears synchronously on desktop");
  const crossedDesktop = fileViewerExpansionAfterViewportChange(crossedNarrow, false, true);
  assert.deepEqual(crossedDesktop, INITIAL_FILE_VIEWER_EXPANSION);

  const phoneOpen = fileViewerExpansionAfterOpen(INITIAL_FILE_VIEWER_EXPANSION, true);
  const rotatedToTablet = fileViewerExpansionAfterViewportChange(phoneOpen, true, true);
  assert.equal(rotatedToTablet.automaticNarrow, true);
  assert.equal(
    isFileViewerExpandedForViewport(phoneOpen, true, false),
    false,
    "a hidden mobile panel stays hidden after rotating into tablet width",
  );
});

test("manual expansion survives crossings while narrow restore suppresses only automatic expansion", async () => {
  const {
    INITIAL_FILE_VIEWER_EXPANSION,
    fileViewerExpansionAfterOpen,
    fileViewerExpansionAfterToggle,
    fileViewerExpansionAfterViewportChange,
    isFileViewerExpanded,
  } = await loadSubject();

  const manualDesktop = fileViewerExpansionAfterToggle(INITIAL_FILE_VIEWER_EXPANSION, false);
  const manualNarrow = fileViewerExpansionAfterViewportChange(manualDesktop, true, true);
  const manualDesktopAgain = fileViewerExpansionAfterViewportChange(manualNarrow, false, true);
  assert.equal(manualDesktopAgain.manual, true);
  assert.equal(manualDesktopAgain.automaticNarrow, false);
  assert.equal(isFileViewerExpanded(manualDesktopAgain), true);

  const automaticNarrow = fileViewerExpansionAfterOpen(INITIAL_FILE_VIEWER_EXPANSION, true);
  const restored = fileViewerExpansionAfterToggle(automaticNarrow, true);
  assert.deepEqual(restored, {
    manual: false,
    automaticNarrow: false,
    automaticNarrowSuppressed: true,
  });
  assert.equal(
    fileViewerExpansionAfterViewportChange(restored, true, true),
    restored,
    "the viewport effect cannot immediately undo a narrow restore",
  );
  const crossedWide = fileViewerExpansionAfterViewportChange(restored, false, true);
  const crossedBack = fileViewerExpansionAfterViewportChange(crossedWide, true, true);
  assert.equal(isFileViewerExpanded(crossedBack), false);

  const reopened = fileViewerExpansionAfterOpen(crossedBack, true);
  assert.equal(reopened.automaticNarrow, true);
  assert.equal(reopened.automaticNarrowSuppressed, false);

  const staleAutomaticAtDesktop = fileViewerExpansionAfterToggle(automaticNarrow, false);
  assert.deepEqual(staleAutomaticAtDesktop, {
    manual: true,
    automaticNarrow: false,
    automaticNarrowSuppressed: false,
  }, "desktop Expand works before the synchronization effect clears stale automatic state");
});

test("pending automatic opens require exact session and cwd identity", async () => {
  const { isSameFileOpenContext } = await loadSubject();
  const captured = { sessionId: "session-a", cwd: "/repo/worktree-a" };

  assert.equal(isSameFileOpenContext(captured, { ...captured }), true);
  assert.equal(isSameFileOpenContext(captured, { sessionId: "session-b", cwd: captured.cwd }), false);
  assert.equal(isSameFileOpenContext(captured, { sessionId: captured.sessionId, cwd: "/repo/worktree-b" }), false);
  assert.equal(isSameFileOpenContext({ sessionId: null, cwd: "/repo/new" }, { sessionId: null, cwd: "/repo/new" }), true);
});

test("AppShell keeps one committed-open boundary and one accessible automatic confirmation owner", async () => {
  const [shell, confirmation, tabBar, css, messageView] = await Promise.all([
    readFile(new URL("../components/AppShell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/AutomaticFileOpenConfirmation.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/TabBar.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../components/MessageView.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(shell, /const handleOpenFile = useCallback/);
  assert.match(shell, /fileViewerExpansionAfterOpen\([\s\S]*isNarrowFileViewerViewport/);
  assert.match(shell, /onOpenFile=\{handleOpenFile\}/);
  assert.match(shell, /onOpenFile=\{handleOpenLinkedFile\}/);
  assert.match(shell, /<AutomaticFileOpenConfirmation/);
  assert.match(confirmation, /role="dialog"/);
  assert.match(confirmation, /aria-modal="true"/);
  assert.match(confirmation, />\s*Open file\s*<\/button>/);
  assert.match(confirmation, />\s*Cancel\s*<\/button>/);
  assert.match(shell, /isSameFileOpenContext/);
  assert.match(shell, /trigger\.isConnected\) trigger\.focus\(\)/);
  assert.match(shell, /button\[data-active-file-tab="true"\]/);
  assert.match(tabBar, /data-active-file-tab=\{isActive/);
  assert.match(messageView, /<MarkdownBody[\s\S]*enableAutomaticFileLinks/);
  assert.match(css, /@media \(min-width: 641px\)[\s\S]*right-panel-container\.right-panel-expanded/);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*right-panel-container\.right-panel-open\s*\{[\s\S]*width: 100%/);
});
