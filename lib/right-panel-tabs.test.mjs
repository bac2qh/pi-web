import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  RIGHT_PANEL_DAG_TAB_ID,
  activeRightPanelTabAfterFileClose,
  nextRightPanelTabIndex,
} = await jiti.import("./right-panel-tabs.ts");

test("right-panel tab keyboard navigation wraps and supports Home and End", () => {
  assert.equal(nextRightPanelTabIndex("ArrowRight", 0, 3), 1);
  assert.equal(nextRightPanelTabIndex("ArrowRight", 2, 3), 0);
  assert.equal(nextRightPanelTabIndex("ArrowLeft", 0, 3), 2);
  assert.equal(nextRightPanelTabIndex("ArrowLeft", 2, 3), 1);
  assert.equal(nextRightPanelTabIndex("Home", 2, 3), 0);
  assert.equal(nextRightPanelTabIndex("End", 0, 3), 2);
  assert.equal(nextRightPanelTabIndex("Enter", 1, 3), null);
  assert.equal(nextRightPanelTabIndex("ArrowRight", -1, 3), null);
  assert.equal(nextRightPanelTabIndex("ArrowRight", 0, 0), null);
});

test("closing files preserves another active tab and falls back to permanent DAG", () => {
  const files = ["file:a", "file:b", "file:c"];
  assert.equal(activeRightPanelTabAfterFileClose(files, "file:c", "file:a"), "file:c");
  assert.equal(activeRightPanelTabAfterFileClose(files, "file:b", "file:b"), "file:c");
  assert.equal(activeRightPanelTabAfterFileClose(files, "file:c", "file:c"), "file:b");
  assert.equal(activeRightPanelTabAfterFileClose(["file:a"], "file:a", "file:a"), RIGHT_PANEL_DAG_TAB_ID);
});

test("AppShell and TabBar keep a lazy permanent semantic DAG tab without resetting expansion", async () => {
  const [shell, tabBar] = await Promise.all([
    readFile(new URL("../components/AppShell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/TabBar.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(shell, /const DAG_TAB: DagTab = \{ kind: "dag", id: RIGHT_PANEL_DAG_TAB_ID, label: "DAG" \}/);
  assert.match(shell, /const \[activeRightPanelTabId, setActiveRightPanelTabId\] = useState<string>\(RIGHT_PANEL_DAG_TAB_ID\)/);
  assert.match(shell, /const \[dagActivated, setDagActivated\] = useState\(false\)/);
  assert.match(shell, /const \[rightPanelOpen, setRightPanelOpen\] = useState\(false\)/);
  assert.match(shell, /const rightPanelTabs = \[DAG_TAB, \.\.\.fileTabs\]/);
  assert.match(shell, /\{dagActivated && \([\s\S]*?<SessionDagPanel[\s\S]*?active=\{dagPanelActive\}[\s\S]*?selectedSessionId=\{selectedSession\?\.id \?\? null\}[\s\S]*?\/?>[\s\S]*?\)\}/);
  assert.match(shell, /aria-hidden=\{!rightPanelOpen\}[\s\S]*?inert=\{!rightPanelOpen\}/);
  assert.match(shell, /fileTabs\.map\(\(fileTab, index\)[\s\S]*?role="tabpanel"[\s\S]*?hidden=\{!selected\}/);
  assert.match(shell, /const panelReplacesOtherContent = fileViewerExpandedActive \|\| isMobile/);
  assert.match(shell, /requestAnimationFrame\(\(\) => selectedTab\.focus\(\)\)/);
  assert.match(shell, /const rightPanelResizeEnabled = panelResizeEligible && rightPanelOpen/);
  assert.match(shell, /ariaLabel: "Resize right panel"/);
  assert.match(shell, /data-resize-handle="right-panel"/);
  assert.match(shell, /const rightPanelRef = rightPanelResizer\.panelRef/);
  assert.doesNotMatch(shell, /fileViewerExpansionAfterFinalClose/);
  assert.doesNotMatch(shell, /setRightPanelOpen\(false\)[\s\S]{0,160}handleCloseFileTab/);

  assert.match(tabBar, /role="tablist"/);
  assert.match(tabBar, /role="tab"/);
  assert.match(tabBar, /aria-selected=\{isActive\}/);
  assert.match(tabBar, /tabIndex=\{isActive \? 0 : -1\}/);
  assert.match(tabBar, /nextRightPanelTabIndex\(event\.key, index, tabs\.length\)/);
  assert.match(tabBar, /event\.key === "Delete" && tab\.kind === "file"/);
  assert.match(tabBar, /aria-keyshortcuts=\{tab\.kind === "file" \? "Delete" : undefined\}/);
  assert.match(tabBar, /className="right-panel-tab-close"[\s\S]*?tabIndex=\{-1\}|tabIndex=\{-1\}[\s\S]*?className="right-panel-tab-close"/);
  assert.match(tabBar, /rightPanelTabPanelDomId\(index\)/);
  assert.match(tabBar, /tab\.kind === "file" &&/);
});
