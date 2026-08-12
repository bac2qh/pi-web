export const DEFAULT_CUSTOM_UI_COLUMNS = 92;
export const DEFAULT_CUSTOM_UI_ROWS = 40;

export interface HeadlessCustomUiTerminal {
  readonly columns: typeof DEFAULT_CUSTOM_UI_COLUMNS;
  readonly rows: typeof DEFAULT_CUSTOM_UI_ROWS;
  readonly kittyProtocolActive: false;
}

export interface HeadlessCustomUiTui {
  readonly terminal: HeadlessCustomUiTerminal;
  requestRender(force?: boolean): void;
}

/** The render-only TUI surface supported by Pi Web extension widgets. */
export function createHeadlessCustomUiTui(
  requestRender: (force?: boolean) => void,
): HeadlessCustomUiTui {
  const terminal = Object.freeze({
    columns: DEFAULT_CUSTOM_UI_COLUMNS,
    rows: DEFAULT_CUSTOM_UI_ROWS,
    kittyProtocolActive: false as const,
  });

  return Object.freeze({ terminal, requestRender });
}
