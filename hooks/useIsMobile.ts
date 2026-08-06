"use client";

import { useSyncExternalStore } from "react";
import { FILE_VIEWER_DIRECT_OPEN_MIN_WIDTH } from "@/lib/file-viewer-layout";

// Breakpoints shared with app/globals.css and the file-action activation contract.
const MOBILE_QUERY = "(max-width: 640px)";
const NARROW_FILE_VIEWER_QUERY = `(max-width: ${FILE_VIEWER_DIRECT_OPEN_MIN_WIDTH - 1}px)`;

function subscribeTo(query: string, cb: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mql = window.matchMedia(query);
  mql.addEventListener("change", cb);
  return () => mql.removeEventListener("change", cb);
}

function getQuerySnapshot(query: string): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia(query).matches;
}

function subscribeMobile(cb: () => void): () => void {
  return subscribeTo(MOBILE_QUERY, cb);
}

function getMobileSnapshot(): boolean {
  return getQuerySnapshot(MOBILE_QUERY);
}

function subscribeNarrowFileViewer(cb: () => void): () => void {
  return subscribeTo(NARROW_FILE_VIEWER_QUERY, cb);
}

function getNarrowFileViewerSnapshot(): boolean {
  return getQuerySnapshot(NARROW_FILE_VIEWER_QUERY);
}

function getServerSnapshot(): boolean {
  return false;
}

/**
 * Returns true when the viewport is at or below the mobile breakpoint.
 * SSR-safe: renders as desktop (false) on the server and first client paint,
 * then syncs to the real viewport after hydration.
 */
export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribeMobile, getMobileSnapshot, getServerSnapshot);
}

/** Returns true below the 1000px direct-open breakpoint. */
export function useIsNarrowFileViewerViewport(): boolean {
  return useSyncExternalStore(
    subscribeNarrowFileViewer,
    getNarrowFileViewerSnapshot,
    getServerSnapshot,
  );
}
