"use client";

import { scaledMenuFontSize } from "@/lib/display-preferences";
import { nextRightPanelTabIndex } from "@/lib/right-panel-tabs";
import { useRef, useState, type KeyboardEvent } from "react";
import { getFileIcon } from "./FileIcons";

export interface DagTab {
  kind: "dag";
  id: "dag";
  label: "DAG";
}

export interface FileTab {
  kind: "file";
  id: string;
  label: string;
  filePath: string;
  sourceSessionId?: string | null;
}

export type Tab = DagTab | FileTab;

interface Props {
  tabs: Tab[];
  activeTabId: string;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
}

export function rightPanelTabDomId(index: number): string {
  return `right-panel-tab-${index}`;
}

export function rightPanelTabPanelDomId(index: number): string {
  return `right-panel-tabpanel-${index}`;
}

function DagIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="6" cy="5" r="2" />
      <circle cx="18" cy="12" r="2" />
      <circle cx="6" cy="19" r="2" />
      <path d="M8 5h3a4 4 0 0 1 4 4v1" />
      <path d="M8 19h3a4 4 0 0 0 4-4v-1" />
    </svg>
  );
}

export function TabBar({ tabs, activeTabId, onSelectTab, onCloseTab }: Props) {
  const tabListRef = useRef<HTMLDivElement | null>(null);
  const [hoveredClose, setHoveredClose] = useState<string | null>(null);

  const moveFocus = (destinationIndex: number) => {
    const boundedIndex = Math.max(0, Math.min(tabs.length - 1, destinationIndex));
    const destination = tabs[boundedIndex];
    if (!destination) return;
    onSelectTab(destination.id);
    requestAnimationFrame(() => {
      tabListRef.current
        ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
        .item(boundedIndex)
        ?.focus();
    });
  };

  const closeTab = (tab: FileTab) => {
    onCloseTab(tab.id);
    requestAnimationFrame(() => {
      tabListRef.current
        ?.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')
        ?.focus();
    });
  };

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number, tab: Tab) => {
    if (event.key === "Delete" && tab.kind === "file") {
      event.preventDefault();
      closeTab(tab);
      return;
    }
    const destination = nextRightPanelTabIndex(event.key, index, tabs.length);
    if (destination === null) return;
    event.preventDefault();
    moveFocus(destination);
  };

  return (
    <div
      ref={tabListRef}
      role="tablist"
      aria-label="Right panel"
      style={{
        display: "flex",
        alignItems: "flex-end",
        background: "var(--bg-panel)",
        overflowX: "auto",
        flexShrink: 0,
        height: 36,
      }}
    >
      {tabs.map((tab, index) => {
        const isActive = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            role="presentation"
            style={{
              display: "flex",
              alignItems: "center",
              height: 36,
              borderRight: "1px solid var(--border)",
              background: isActive ? "var(--bg)" : "var(--bg-panel)",
              maxWidth: 180,
              minWidth: tab.kind === "dag" ? 76 : 80,
              flexShrink: 0,
              transition: "background 0.1s, color 0.1s",
            }}
          >
            <button
              type="button"
              role="tab"
              id={rightPanelTabDomId(index)}
              aria-controls={rightPanelTabPanelDomId(index)}
              aria-selected={isActive}
              tabIndex={isActive ? 0 : -1}
              onClick={() => onSelectTab(tab.id)}
              onKeyDown={(event) => handleTabKeyDown(event, index, tab)}
              aria-keyshortcuts={tab.kind === "file" ? "Delete" : undefined}
              data-active-file-tab={isActive && tab.kind === "file" ? "true" : undefined}
              className="right-panel-tab"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                height: 36,
                paddingLeft: 12,
                paddingRight: tab.kind === "file" ? 2 : 12,
                minWidth: 0,
                flex: 1,
                background: "transparent",
                border: "none",
                color: isActive ? "var(--text)" : "var(--text-muted)",
                cursor: "pointer",
                fontSize: scaledMenuFontSize(12),
                whiteSpace: "nowrap",
                userSelect: "none",
              }}
            >
              <span style={{ flexShrink: 0, opacity: isActive ? 1 : 0.7, display: "flex", alignItems: "center" }}>
                {tab.kind === "dag" ? <DagIcon /> : getFileIcon(tab.label, 13)}
              </span>
              <span
                style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  flex: 1,
                  fontWeight: isActive ? 500 : 400,
                  textAlign: "left",
                }}
                title={tab.kind === "file" ? tab.filePath : "Session dependency graph"}
              >
                {tab.label}
              </span>
            </button>
            {tab.kind === "file" && (
              <button
                type="button"
                tabIndex={-1}
                onClick={() => closeTab(tab)}
                onMouseEnter={() => setHoveredClose(tab.id)}
                onMouseLeave={() => setHoveredClose(null)}
                className="right-panel-tab-close"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 24,
                  height: 24,
                  marginRight: 4,
                  background: hoveredClose === tab.id ? "var(--bg-hover)" : "transparent",
                  border: "none",
                  borderRadius: 4,
                  color: hoveredClose === tab.id ? "var(--text)" : "var(--text-dim)",
                  cursor: "pointer",
                  padding: 0,
                  flexShrink: 0,
                  transition: "background 0.1s, color 0.1s",
                }}
                title="Close"
                aria-label={`Close ${tab.label}`}
              >
                <svg width="11" height="11" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                  <line x1="2" y1="2" x2="8" y2="8" />
                  <line x1="8" y1="2" x2="2" y2="8" />
                </svg>
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
