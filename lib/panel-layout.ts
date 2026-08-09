export const PANEL_RESIZE_MIN_VIEWPORT_WIDTH = 1_000;
export const PANEL_LAYOUT_MOBILE_MAX_WIDTH = 640;

export const SIDEBAR_DEFAULT_WIDTH = 260;
export const SIDEBAR_MIN_WIDTH = 180;
export const SIDEBAR_MAX_WIDTH = 480;

export const RIGHT_PANEL_DEFAULT_RATIO = 0.42;
export const RIGHT_PANEL_FALLBACK_WIDTH = 420;
export const RIGHT_PANEL_MIN_WIDTH = 300;
export const RIGHT_PANEL_MAX_WIDTH = 1_200;

export const CONVERSATION_MIN_WIDTH = 320;

export const SIDEBAR_WIDTH_STORAGE_KEY = "pi-sidebar-width";
export const RIGHT_PANEL_WIDTH_STORAGE_KEY = "pi-right-panel-width";

export interface PanelWidthBounds {
  minWidth: number;
  maxWidth: number;
}

export interface PanelLayoutOptions {
  viewportWidth: number;
  sidebarVisible: boolean;
  rightPanelVisible: boolean;
  sidebarPreferredWidth: number | null;
  rightPanelPreferredWidth: number | null;
}

export interface EffectivePanelLayout {
  sidebarWidth: number;
  rightPanelWidth: number;
  conversationWidth: number;
  sidebarBounds: PanelWidthBounds;
  rightPanelBounds: PanelWidthBounds;
}

function finiteViewportWidth(viewportWidth: number): number {
  return Number.isFinite(viewportWidth) && viewportWidth > 0
    ? Math.floor(viewportWidth)
    : 0;
}

export function clampPanelWidth(width: number, minWidth: number, maxWidth: number): number {
  const finiteMin = Number.isFinite(minWidth) ? minWidth : 0;
  const finiteMax = Number.isFinite(maxWidth) ? maxWidth : finiteMin;
  const lower = Math.min(finiteMin, Math.max(finiteMin, finiteMax));
  const upper = Math.max(lower, finiteMax);
  const candidate = Number.isFinite(width) ? width : lower;
  return Math.round(Math.max(lower, Math.min(upper, candidate)));
}

/** Parse only a complete finite numeric storage value, never a numeric prefix. */
export function parseStoredPanelWidth(rawValue: string | null): number | null {
  if (rawValue === null) return null;
  const trimmed = rawValue.trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizePreferredPanelWidth(
  preferredWidth: number | null,
  minWidth: number,
  maxWidth: number,
): number | null {
  return preferredWidth === null
    ? null
    : clampPanelWidth(preferredWidth, minWidth, maxWidth);
}

export function getDefaultRightPanelWidth(viewportWidth: number): number {
  const width = finiteViewportWidth(viewportWidth);
  if (width === 0) return RIGHT_PANEL_FALLBACK_WIDTH;
  return clampPanelWidth(
    width * RIGHT_PANEL_DEFAULT_RATIO,
    RIGHT_PANEL_MIN_WIDTH,
    RIGHT_PANEL_MAX_WIDTH,
  );
}

export function getSidebarWidthBounds(options: {
  viewportWidth: number;
  rightPanelVisible: boolean;
  rightPanelWidth: number;
}): PanelWidthBounds {
  const viewportWidth = finiteViewportWidth(options.viewportWidth);
  const rightPanelWidth = options.rightPanelVisible
    ? clampPanelWidth(options.rightPanelWidth, RIGHT_PANEL_MIN_WIDTH, RIGHT_PANEL_MAX_WIDTH)
    : 0;
  const dynamicMax = viewportWidth - CONVERSATION_MIN_WIDTH - rightPanelWidth;
  return {
    minWidth: SIDEBAR_MIN_WIDTH,
    maxWidth: Math.max(
      SIDEBAR_MIN_WIDTH,
      Math.min(SIDEBAR_MAX_WIDTH, dynamicMax),
    ),
  };
}

export function getRightPanelWidthBounds(options: {
  viewportWidth: number;
  sidebarVisible: boolean;
  sidebarWidth: number;
}): PanelWidthBounds {
  const viewportWidth = finiteViewportWidth(options.viewportWidth);
  const sidebarWidth = options.sidebarVisible
    ? clampPanelWidth(options.sidebarWidth, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH)
    : 0;
  const dynamicMax = viewportWidth - CONVERSATION_MIN_WIDTH - sidebarWidth;
  return {
    minWidth: RIGHT_PANEL_MIN_WIDTH,
    maxWidth: Math.max(
      RIGHT_PANEL_MIN_WIDTH,
      Math.min(RIGHT_PANEL_MAX_WIDTH, dynamicMax),
    ),
  };
}

function fitBothPanels(
  sidebarTarget: number,
  rightPanelTarget: number,
  sidePanelBudget: number,
): { sidebarWidth: number; rightPanelWidth: number } {
  const minimumTotal = SIDEBAR_MIN_WIDTH + RIGHT_PANEL_MIN_WIDTH;
  if (sidePanelBudget <= minimumTotal) {
    return {
      sidebarWidth: SIDEBAR_MIN_WIDTH,
      rightPanelWidth: RIGHT_PANEL_MIN_WIDTH,
    };
  }

  if (sidebarTarget + rightPanelTarget <= sidePanelBudget) {
    return { sidebarWidth: sidebarTarget, rightPanelWidth: rightPanelTarget };
  }

  const sidebarExtra = sidebarTarget - SIDEBAR_MIN_WIDTH;
  const rightPanelExtra = rightPanelTarget - RIGHT_PANEL_MIN_WIDTH;
  const desiredExtra = sidebarExtra + rightPanelExtra;
  const availableExtra = sidePanelBudget - minimumTotal;
  const allocatedSidebarExtra = desiredExtra === 0
    ? 0
    : Math.round(availableExtra * (sidebarExtra / desiredExtra));

  return {
    sidebarWidth: SIDEBAR_MIN_WIDTH + allocatedSidebarExtra,
    rightPanelWidth: RIGHT_PANEL_MIN_WIDTH + (availableExtra - allocatedSidebarExtra),
  };
}

/**
 * Resolve temporary effective widths without mutating either preferred width.
 * When both visible preferences cannot fit, their space above the absolute
 * minima is reduced proportionally so the result is deterministic and fair.
 */
export function resolveEffectivePanelLayout(options: PanelLayoutOptions): EffectivePanelLayout {
  const viewportWidth = finiteViewportWidth(options.viewportWidth);
  const sidebarTarget = normalizePreferredPanelWidth(
    options.sidebarPreferredWidth,
    SIDEBAR_MIN_WIDTH,
    SIDEBAR_MAX_WIDTH,
  ) ?? SIDEBAR_DEFAULT_WIDTH;
  const rightPanelTarget = normalizePreferredPanelWidth(
    options.rightPanelPreferredWidth,
    RIGHT_PANEL_MIN_WIDTH,
    RIGHT_PANEL_MAX_WIDTH,
  ) ?? getDefaultRightPanelWidth(viewportWidth);

  let sidebarWidth = sidebarTarget;
  let rightPanelWidth = rightPanelTarget;
  const sidePanelBudget = Math.max(0, viewportWidth - CONVERSATION_MIN_WIDTH);

  if (options.sidebarVisible && options.rightPanelVisible) {
    ({ sidebarWidth, rightPanelWidth } = fitBothPanels(
      sidebarTarget,
      rightPanelTarget,
      sidePanelBudget,
    ));
  } else if (options.sidebarVisible) {
    sidebarWidth = clampPanelWidth(
      sidebarTarget,
      SIDEBAR_MIN_WIDTH,
      Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, sidePanelBudget)),
    );
  } else if (options.rightPanelVisible) {
    rightPanelWidth = clampPanelWidth(
      rightPanelTarget,
      RIGHT_PANEL_MIN_WIDTH,
      Math.max(RIGHT_PANEL_MIN_WIDTH, Math.min(RIGHT_PANEL_MAX_WIDTH, sidePanelBudget)),
    );
  }

  const visibleSidebarWidth = options.sidebarVisible ? sidebarWidth : 0;
  const visibleRightPanelWidth = options.rightPanelVisible ? rightPanelWidth : 0;
  const conversationWidth = Math.max(
    0,
    viewportWidth - visibleSidebarWidth - visibleRightPanelWidth,
  );

  return {
    sidebarWidth,
    rightPanelWidth,
    conversationWidth,
    sidebarBounds: getSidebarWidthBounds({
      viewportWidth,
      rightPanelVisible: options.rightPanelVisible,
      rightPanelWidth,
    }),
    rightPanelBounds: getRightPanelWidthBounds({
      viewportWidth,
      sidebarVisible: options.sidebarVisible,
      sidebarWidth,
    }),
  };
}
