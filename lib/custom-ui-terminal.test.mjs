import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  createHeadlessCustomUiTui,
  DEFAULT_CUSTOM_UI_COLUMNS,
  DEFAULT_CUSTOM_UI_ROWS,
} = await jiti.import("./custom-ui-terminal.ts");

test("headless extension-widget TUI is a frozen fixed-dimension render facade", () => {
  const tui = createHeadlessCustomUiTui(() => {});

  assert.deepEqual(tui.terminal, {
    columns: 92,
    rows: 40,
    kittyProtocolActive: false,
  });
  assert.equal(DEFAULT_CUSTOM_UI_COLUMNS, 92);
  assert.equal(DEFAULT_CUSTOM_UI_ROWS, 40);
  assert.deepEqual(Object.keys(tui).sort(), ["requestRender", "terminal"]);
  assert.deepEqual(Object.keys(tui.terminal).sort(), ["columns", "kittyProtocolActive", "rows"]);
  assert.equal(Object.isFrozen(tui), true);
  assert.equal(Object.isFrozen(tui.terminal), true);
});

test("headless extension-widget TUI forwards optional force without adding terminal behavior", () => {
  const requests = [];
  const tui = createHeadlessCustomUiTui((force) => requests.push(force));

  tui.requestRender();
  tui.requestRender(false);
  tui.requestRender(true);

  assert.deepEqual(requests, [undefined, false, true]);
  assert.equal("focus" in tui, false);
  assert.equal("handleInput" in tui, false);
  assert.equal("showOverlay" in tui, false);
});
