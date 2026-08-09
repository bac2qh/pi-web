export const RIGHT_PANEL_DAG_TAB_ID = "dag" as const;

export function nextRightPanelTabIndex(
  key: string,
  currentIndex: number,
  tabCount: number,
): number | null {
  if (!Number.isInteger(currentIndex) || !Number.isInteger(tabCount)
    || tabCount <= 0 || currentIndex < 0 || currentIndex >= tabCount) {
    return null;
  }
  if (key === "ArrowRight") return (currentIndex + 1) % tabCount;
  if (key === "ArrowLeft") return (currentIndex - 1 + tabCount) % tabCount;
  if (key === "Home") return 0;
  if (key === "End") return tabCount - 1;
  return null;
}

export function activeRightPanelTabAfterFileClose(
  fileTabIds: readonly string[],
  activeTabId: string,
  closingTabId: string,
): string {
  if (activeTabId !== closingTabId) return activeTabId;
  const closingIndex = fileTabIds.indexOf(closingTabId);
  const remaining = fileTabIds.filter((tabId) => tabId !== closingTabId);
  if (remaining.length === 0) return RIGHT_PANEL_DAG_TAB_ID;
  const nextIndex = Math.min(Math.max(0, closingIndex), remaining.length - 1);
  return remaining[nextIndex];
}
