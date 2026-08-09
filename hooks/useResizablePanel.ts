"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  clampPanelWidth,
  normalizePreferredPanelWidth,
  parseStoredPanelWidth,
  type PanelWidthBounds,
} from "@/lib/panel-layout";

interface ActiveDrag {
  pointerId: number;
  startX: number;
  startWidth: number;
  lastPointerWidth: number;
  pointerMoved: boolean;
  target: HTMLDivElement;
  previousCursor: string;
  previousUserSelect: string;
  token: symbol;
}

interface UseResizablePanelOptions {
  ariaLabel: string;
  cssVariable: `--${string}`;
  defaultWidth: number;
  enabled: boolean;
  getBounds: () => PanelWidthBounds;
  getDefaultWidth?: () => number;
  growthDirection: "left" | "right";
  maxWidth: number;
  minWidth: number;
  storageKey: string;
  widthRef: MutableRefObject<number>;
}

interface FinishResizeOptions {
  commitPreference?: boolean;
  pointerId?: number;
  updateReactState?: boolean;
}

let activePanelResize: { token: symbol; cancel: () => void } | null = null;

function readStoredWidth(storageKey: string): number | null {
  try {
    return parseStoredPanelWidth(window.localStorage.getItem(storageKey));
  } catch {
    return null;
  }
}

function writeStoredWidth(storageKey: string, width: number): void {
  try {
    window.localStorage.setItem(storageKey, String(width));
  } catch {
    // Page-local resizing remains available when browser storage is blocked.
  }
}

function removeStoredWidth(storageKey: string): void {
  try {
    window.localStorage.removeItem(storageKey);
  } catch {
    // Reset still applies for this page when browser storage is blocked.
  }
}

export function useResizablePanel(options: UseResizablePanelOptions) {
  const {
    ariaLabel,
    cssVariable,
    defaultWidth,
    enabled,
    getBounds,
    getDefaultWidth,
    growthDirection,
    maxWidth,
    minWidth,
    storageKey,
    widthRef,
  } = options;
  const panelRef = useRef<HTMLDivElement>(null);
  const separatorRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<ActiveDrag | null>(null);
  const preferredWidthRef = useRef<number | null>(null);
  const restoredRef = useRef(false);
  const [ready, setReady] = useState(false);
  const [width, setWidth] = useState(defaultWidth);

  const getSafeBounds = useCallback((): PanelWidthBounds => {
    const bounds = getBounds();
    const boundedMin = clampPanelWidth(bounds.minWidth, minWidth, maxWidth);
    const boundedMax = clampPanelWidth(bounds.maxWidth, boundedMin, maxWidth);
    return { minWidth: boundedMin, maxWidth: Math.max(boundedMin, boundedMax) };
  }, [getBounds, maxWidth, minWidth]);

  const applyLiveWidth = useCallback((candidate: number, bounds?: PanelWidthBounds): number => {
    const activeBounds = bounds ?? getSafeBounds();
    const nextWidth = clampPanelWidth(
      candidate,
      activeBounds.minWidth,
      activeBounds.maxWidth,
    );
    widthRef.current = nextWidth;
    panelRef.current?.style.setProperty(cssVariable, `${nextWidth}px`);
    separatorRef.current?.setAttribute("aria-valuemin", String(activeBounds.minWidth));
    separatorRef.current?.setAttribute("aria-valuemax", String(activeBounds.maxWidth));
    separatorRef.current?.setAttribute("aria-valuenow", String(nextWidth));
    separatorRef.current?.setAttribute("aria-valuetext", `${nextWidth} pixels`);
    return nextWidth;
  }, [cssVariable, getSafeBounds, widthRef]);

  const setReconciledWidth = useCallback((
    candidate: number,
    updateReactState = true,
    reconciledBounds?: PanelWidthBounds,
  ): number => {
    const nextWidth = clampPanelWidth(candidate, minWidth, maxWidth);
    widthRef.current = nextWidth;
    panelRef.current?.style.setProperty(cssVariable, `${nextWidth}px`);
    const bounds = reconciledBounds ?? getSafeBounds();
    separatorRef.current?.setAttribute("aria-valuemin", String(bounds.minWidth));
    separatorRef.current?.setAttribute("aria-valuemax", String(bounds.maxWidth));
    separatorRef.current?.setAttribute("aria-valuenow", String(nextWidth));
    separatorRef.current?.setAttribute("aria-valuetext", `${nextWidth} pixels`);
    if (updateReactState) setWidth(nextWidth);
    return nextWidth;
  }, [cssVariable, getSafeBounds, maxWidth, minWidth, widthRef]);

  const getPreferredWidth = useCallback(() => preferredWidthRef.current, []);

  const finishResize = useCallback((finishOptions: FinishResizeOptions = {}) => {
    const {
      commitPreference = true,
      pointerId,
      updateReactState = true,
    } = finishOptions;
    const drag = dragRef.current;
    if (!drag || (pointerId !== undefined && drag.pointerId !== pointerId)) return;

    dragRef.current = null;
    if (activePanelResize?.token === drag.token) activePanelResize = null;

    const bounds = getSafeBounds();
    const nextWidth = applyLiveWidth(widthRef.current, bounds);
    const intentionallyChanged = commitPreference
      && drag.pointerMoved
      && nextWidth === drag.lastPointerWidth
      && nextWidth !== drag.startWidth;
    if (intentionallyChanged) {
      preferredWidthRef.current = nextWidth;
      writeStoredWidth(storageKey, nextWidth);
    }
    if (updateReactState) setWidth(nextWidth);

    panelRef.current?.classList.remove("panel-resizing");
    drag.target.classList.remove("is-resizing");
    document.body.style.cursor = drag.previousCursor;
    document.body.style.userSelect = drag.previousUserSelect;

    try {
      if (drag.target.hasPointerCapture(drag.pointerId)) {
        drag.target.releasePointerCapture(drag.pointerId);
      }
    } catch {
      // Cancellation or DOM removal may have already released capture.
    }
  }, [applyLiveWidth, getSafeBounds, storageKey, widthRef]);

  const cancelResize = useCallback((commitPreference = true) => {
    finishResize({ commitPreference });
  }, [finishResize]);

  const commitPreferredWidth = useCallback((candidate: number, force = false) => {
    const bounds = getSafeBounds();
    const nextWidth = clampPanelWidth(candidate, bounds.minWidth, bounds.maxWidth);
    if (!force && nextWidth === widthRef.current) return nextWidth;
    preferredWidthRef.current = nextWidth;
    writeStoredWidth(storageKey, nextWidth);
    applyLiveWidth(nextWidth, bounds);
    setWidth(nextWidth);
    return nextWidth;
  }, [applyLiveWidth, getSafeBounds, storageKey, widthRef]);

  const resetWidth = useCallback(() => {
    preferredWidthRef.current = null;
    removeStoredWidth(storageKey);
    const bounds = getSafeBounds();
    const nextDefault = getDefaultWidth?.() ?? defaultWidth;
    const nextWidth = applyLiveWidth(nextDefault, bounds);
    setWidth(nextWidth);
    return nextWidth;
  }, [applyLiveWidth, defaultWidth, getDefaultWidth, getSafeBounds, storageKey]);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!enabled || !event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();

    activePanelResize?.cancel();

    const target = event.currentTarget;
    try {
      target.setPointerCapture(event.pointerId);
    } catch {
      return;
    }

    target.focus({ preventScroll: true });
    const token = Symbol("panel-resize");
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: widthRef.current,
      lastPointerWidth: widthRef.current,
      pointerMoved: false,
      target,
      previousCursor: document.body.style.cursor,
      previousUserSelect: document.body.style.userSelect,
      token,
    };
    activePanelResize = { token, cancel: () => finishResize({ pointerId: event.pointerId }) };

    panelRef.current?.classList.add("panel-resizing");
    target.classList.add("is-resizing");
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [enabled, finishResize, widthRef]);

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (event.pointerType === "mouse" && event.buttons === 0) {
      finishResize({ pointerId: event.pointerId });
      return;
    }

    event.preventDefault();
    const direction = growthDirection === "right" ? 1 : -1;
    const nextWidth = drag.startWidth + ((event.clientX - drag.startX) * direction);
    drag.pointerMoved ||= event.clientX !== drag.startX;
    drag.lastPointerWidth = applyLiveWidth(nextWidth);
  }, [applyLiveWidth, finishResize, growthDirection]);

  const onPointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    finishResize({ pointerId: event.pointerId });
  }, [finishResize]);

  const onPointerCancel = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    finishResize({ pointerId: event.pointerId });
  }, [finishResize]);

  const onLostPointerCapture = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    finishResize({ pointerId: event.pointerId });
  }, [finishResize]);

  const onKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!enabled) return;
    const step = event.shiftKey ? 32 : 12;
    const growKey = growthDirection === "right" ? "ArrowRight" : "ArrowLeft";
    const shrinkKey = growthDirection === "right" ? "ArrowLeft" : "ArrowRight";

    if (event.key === growKey) {
      event.preventDefault();
      commitPreferredWidth(widthRef.current + step);
    } else if (event.key === shrinkKey) {
      event.preventDefault();
      commitPreferredWidth(widthRef.current - step);
    } else if (event.key === "Home") {
      event.preventDefault();
      commitPreferredWidth(getSafeBounds().minWidth, true);
    } else if (event.key === "End") {
      event.preventDefault();
      commitPreferredWidth(getSafeBounds().maxWidth, true);
    } else if (event.key === "Enter") {
      event.preventDefault();
      resetWidth();
    }
  }, [commitPreferredWidth, enabled, getSafeBounds, growthDirection, resetWidth, widthRef]);

  useLayoutEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    preferredWidthRef.current = normalizePreferredPanelWidth(
      readStoredWidth(storageKey),
      minWidth,
      maxWidth,
    );
    setReady(true);
  }, [maxWidth, minWidth, storageKey]);

  useEffect(() => {
    if (enabled) return;
    finishResize();
  }, [enabled, finishResize]);

  useEffect(() => {
    const onWindowBlur = () => finishResize();
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") finishResize();
    };
    window.addEventListener("blur", onWindowBlur);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("blur", onWindowBlur);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [finishResize]);

  useEffect(() => () => {
    finishResize({ updateReactState: false });
  }, [finishResize]);

  const bounds = getSafeBounds();

  return {
    cancelResize,
    getPreferredWidth,
    panelRef,
    ready,
    resetWidth,
    setReconciledWidth,
    separatorProps: {
      "aria-label": ariaLabel,
      "aria-orientation": "vertical" as const,
      "aria-valuemax": bounds.maxWidth,
      "aria-valuemin": bounds.minWidth,
      "aria-valuenow": width,
      "aria-valuetext": `${width} pixels`,
      onDoubleClick: resetWidth,
      onKeyDown,
      onLostPointerCapture,
      onPointerCancel,
      onPointerDown,
      onPointerMove,
      onPointerUp,
      ref: separatorRef,
      role: "separator" as const,
      tabIndex: 0,
    },
    width,
  };
}
