import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function loadSubject() {
  return import("./panel-layout.ts");
}

test("parses only complete finite stored widths", async () => {
  const { parseStoredPanelWidth } = await loadSubject();

  assert.equal(parseStoredPanelWidth(null), null);
  assert.equal(parseStoredPanelWidth(""), null);
  assert.equal(parseStoredPanelWidth("   "), null);
  assert.equal(parseStoredPanelWidth("300px"), null);
  assert.equal(parseStoredPanelWidth("300junk"), null);
  assert.equal(parseStoredPanelWidth("Infinity"), null);
  assert.equal(parseStoredPanelWidth("NaN"), null);
  assert.equal(parseStoredPanelWidth("1e3"), null);
  assert.equal(parseStoredPanelWidth("420"), 420);
  assert.equal(parseStoredPanelWidth(" 420.5 "), 420.5);
  assert.equal(parseStoredPanelWidth("-20"), -20);
});

test("clamps finite, malformed, and inverted width inputs safely", async () => {
  const { clampPanelWidth, normalizePreferredPanelWidth } = await loadSubject();

  assert.equal(clampPanelWidth(420.4, 180, 480), 420);
  assert.equal(clampPanelWidth(120, 180, 480), 180);
  assert.equal(clampPanelWidth(600, 180, 480), 480);
  assert.equal(clampPanelWidth(Number.NaN, 180, 480), 180);
  assert.equal(clampPanelWidth(200, 300, 250), 300);
  assert.equal(normalizePreferredPanelWidth(null, 180, 480), null);
  assert.equal(normalizePreferredPanelWidth(-10_000, 180, 480), 180);
  assert.equal(normalizePreferredPanelWidth(10_000, 180, 480), 480);
});

test("keeps an unset file viewer responsive at the current 42 percent default", async () => {
  const {
    PANEL_RESIZE_MIN_VIEWPORT_WIDTH,
    RIGHT_PANEL_FALLBACK_WIDTH,
    getDefaultRightPanelWidth,
  } = await loadSubject();
  const { FILE_VIEWER_DIRECT_OPEN_MIN_WIDTH } = await import("./file-viewer-layout.ts");

  assert.equal(PANEL_RESIZE_MIN_VIEWPORT_WIDTH, FILE_VIEWER_DIRECT_OPEN_MIN_WIDTH);
  assert.equal(getDefaultRightPanelWidth(Number.NaN), RIGHT_PANEL_FALLBACK_WIDTH);
  assert.equal(getDefaultRightPanelWidth(500), 300);
  assert.equal(getDefaultRightPanelWidth(1_000), 420);
  assert.equal(getDefaultRightPanelWidth(1_366), 574);
  assert.equal(getDefaultRightPanelWidth(1_920), 806);
  assert.equal(getDefaultRightPanelWidth(4_000), 1_200);
});

test("derives pairwise maxima from the other visible panel and the 320px center", async () => {
  const {
    getRightPanelWidthBounds,
    getSidebarWidthBounds,
  } = await loadSubject();

  assert.deepEqual(getSidebarWidthBounds({
    viewportWidth: 1_000,
    rightPanelVisible: true,
    rightPanelWidth: 420,
  }), { minWidth: 180, maxWidth: 260 });
  assert.deepEqual(getRightPanelWidthBounds({
    viewportWidth: 1_000,
    sidebarVisible: true,
    sidebarWidth: 260,
  }), { minWidth: 300, maxWidth: 420 });
  assert.deepEqual(getSidebarWidthBounds({
    viewportWidth: 1_000,
    rightPanelVisible: false,
    rightPanelWidth: 1_200,
  }), { minWidth: 180, maxWidth: 480 });
  assert.deepEqual(getRightPanelWidthBounds({
    viewportWidth: 1_000,
    sidebarVisible: false,
    sidebarWidth: 480,
  }), { minWidth: 300, maxWidth: 680 });
});

test("resolves current defaults without changing the 1000px layout", async () => {
  const { resolveEffectivePanelLayout } = await loadSubject();

  const layout = resolveEffectivePanelLayout({
    viewportWidth: 1_000,
    sidebarVisible: true,
    rightPanelVisible: true,
    sidebarPreferredWidth: null,
    rightPanelPreferredWidth: null,
  });

  assert.equal(layout.sidebarWidth, 260);
  assert.equal(layout.rightPanelWidth, 420);
  assert.equal(layout.conversationWidth, 320);
  assert.deepEqual(layout.sidebarBounds, { minWidth: 180, maxWidth: 260 });
  assert.deepEqual(layout.rightPanelBounds, { minWidth: 300, maxWidth: 420 });
});

test("jointly clamps extreme preferences without erasing their wider-layout result", async () => {
  const { resolveEffectivePanelLayout } = await loadSubject();
  const preferences = {
    sidebarPreferredWidth: 480,
    rightPanelPreferredWidth: 1_200,
  };

  const contracted = resolveEffectivePanelLayout({
    viewportWidth: 1_000,
    sidebarVisible: true,
    rightPanelVisible: true,
    ...preferences,
  });
  assert.deepEqual({
    sidebar: contracted.sidebarWidth,
    right: contracted.rightPanelWidth,
    center: contracted.conversationWidth,
  }, { sidebar: 230, right: 450, center: 320 });
  assert.equal(contracted.sidebarBounds.maxWidth, contracted.sidebarWidth);
  assert.equal(contracted.rightPanelBounds.maxWidth, contracted.rightPanelWidth);

  const expanded = resolveEffectivePanelLayout({
    viewportWidth: 2_500,
    sidebarVisible: true,
    rightPanelVisible: true,
    ...preferences,
  });
  assert.deepEqual({
    sidebar: expanded.sidebarWidth,
    right: expanded.rightPanelWidth,
    center: expanded.conversationWidth,
  }, { sidebar: 480, right: 1_200, center: 820 });
});

test("panel visibility changes only consume space for visible panels", async () => {
  const { resolveEffectivePanelLayout } = await loadSubject();
  const preferences = {
    viewportWidth: 1_000,
    sidebarPreferredWidth: 480,
    rightPanelPreferredWidth: 1_200,
  };

  const sidebarOnly = resolveEffectivePanelLayout({
    ...preferences,
    sidebarVisible: true,
    rightPanelVisible: false,
  });
  assert.equal(sidebarOnly.sidebarWidth, 480);
  assert.equal(sidebarOnly.rightPanelWidth, 1_200, "the hidden preference remains available");
  assert.equal(sidebarOnly.conversationWidth, 520);

  const rightOnly = resolveEffectivePanelLayout({
    ...preferences,
    sidebarVisible: false,
    rightPanelVisible: true,
  });
  assert.equal(rightOnly.sidebarWidth, 480, "the hidden preference remains available");
  assert.equal(rightOnly.rightPanelWidth, 680);
  assert.equal(rightOnly.conversationWidth, 320);

  const neither = resolveEffectivePanelLayout({
    ...preferences,
    sidebarVisible: false,
    rightPanelVisible: false,
  });
  assert.equal(neither.conversationWidth, 1_000);
});

test("unset defaults keep tracking the viewport after a temporary clamp", async () => {
  const { resolveEffectivePanelLayout } = await loadSubject();
  const narrow = resolveEffectivePanelLayout({
    viewportWidth: 1_000,
    sidebarVisible: true,
    rightPanelVisible: true,
    sidebarPreferredWidth: 480,
    rightPanelPreferredWidth: null,
  });
  assert.equal(narrow.conversationWidth, 320);
  assert.equal(narrow.sidebarWidth + narrow.rightPanelWidth, 680);

  const wide = resolveEffectivePanelLayout({
    viewportWidth: 1_400,
    sidebarVisible: true,
    rightPanelVisible: true,
    sidebarPreferredWidth: 480,
    rightPanelPreferredWidth: null,
  });
  assert.equal(wide.sidebarWidth, 480);
  assert.equal(wide.rightPanelWidth, 588);
  assert.equal(wide.conversationWidth, 332);
});

test("non-mobile narrow split fallback stays finite and within the viewport", async () => {
  const { resolveEffectivePanelLayout } = await loadSubject();
  const layout = resolveEffectivePanelLayout({
    viewportWidth: 641,
    sidebarVisible: true,
    rightPanelVisible: true,
    sidebarPreferredWidth: 10_000,
    rightPanelPreferredWidth: 10_000,
  });

  assert.equal(layout.sidebarWidth, 180);
  assert.equal(layout.rightPanelWidth, 300);
  assert.equal(layout.conversationWidth, 161);
  assert.equal(layout.sidebarWidth + layout.rightPanelWidth + layout.conversationWidth, 641);
});

test("AppShell and the shared hook preserve accessible mounted split behavior", async () => {
  const [shell, hook, css] = await Promise.all([
    readFile(new URL("../components/AppShell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../hooks/useResizablePanel.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(shell, /ariaLabel: "Resize sidebar"/);
  assert.match(shell, /ariaLabel: "Resize file viewer"/);
  assert.match(shell, /data-resize-handle="sidebar"/);
  assert.match(shell, /data-resize-handle="file-viewer"/);
  assert.match(shell, /aria-controls="session-sidebar"/);
  assert.match(shell, /aria-controls="file-panel"/);
  assert.match(shell, /panelResizeEligible = !isNarrowFileViewerViewport && !fileViewerExpandedActive/);
  assert.match(shell, /sidebarResizer\.ready && sidebarResizeEnabled/);
  assert.match(shell, /rightPanelResizer\.ready && rightPanelResizeEnabled/);
  assert.equal((shell.match(/<ChatWindow/g) ?? []).length, 1);
  assert.equal((shell.match(/<FileViewer/g) ?? []).length, 1);

  assert.match(hook, /role: "separator" as const/);
  assert.match(hook, /"aria-orientation": "vertical" as const/);
  assert.match(hook, /"aria-valuemin"/);
  assert.match(hook, /"aria-valuemax"/);
  assert.match(hook, /"aria-valuenow"/);
  assert.match(hook, /"aria-valuetext"/);
  assert.match(hook, /event\.isPrimary/);
  assert.match(hook, /setPointerCapture\(event\.pointerId\)/);
  assert.match(hook, /onLostPointerCapture/);
  assert.match(hook, /window\.addEventListener\("blur"/);
  assert.match(hook, /document\.addEventListener\("visibilitychange"/);
  assert.match(hook, /drag\.pointerMoved/);
  assert.match(hook, /nextWidth === drag\.lastPointerWidth/);
  assert.match(hook, /removeStoredWidth\(storageKey\)/);
  assert.match(hook, /useLayoutEffect\(\(\) => \{[\s\S]*readStoredWidth\(storageKey\)/);
  assert.match(shell, /cancelSidebarResize\(false\)/);
  assert.match(shell, /reconcileEffectivePanelWidths\(false\)/);
  assert.match(shell, /setReconciledSidebarWidth\([\s\S]*layout\.sidebarBounds/);
  assert.match(shell, /setReconciledRightPanelWidth\([\s\S]*layout\.rightPanelBounds/);
  assert.match(hook, /event\.key === "Home"/);
  assert.match(hook, /event\.key === "End"/);
  assert.match(hook, /event\.key === "Enter"/);

  const pointerMove = hook.slice(
    hook.indexOf("const onPointerMove"),
    hook.indexOf("const onPointerUp"),
  );
  assert.match(pointerMove, /applyLiveWidth\(nextWidth\)/);
  assert.doesNotMatch(pointerMove, /setWidth\(/, "pointer moves must not update React state");

  assert.match(css, /sidebar-container\.sidebar-open\s*\{[\s\S]*var\(--sidebar-width, 260px\)/);
  assert.match(css, /sidebar-container > \*\s*\{[\s\S]*var\(--sidebar-width, 260px\)/);
  assert.match(css, /right-panel-container\.right-panel-open\s*\{[\s\S]*var\(--right-panel-width, 42%\)/);
  assert.match(css, /right-panel-container > \*\s*\{[\s\S]*var\(--right-panel-width, 42vw\)/);
  assert.match(css, /@media \(max-width: 999px\)[\s\S]*panel-resize-handle[\s\S]*display: none !important/);
  assert.match(css, /app-shell\.file-viewer-expanded > \.panel-resize-handle/);
  assert.match(css, /right-panel-container\.right-panel-expanded\s*\{[\s\S]*width: 100%/);
  assert.match(css, /right-panel-container\.right-panel-expanded > \*\s*\{[\s\S]*width: 100%/);
});
