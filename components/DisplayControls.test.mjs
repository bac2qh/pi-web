import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { DisplayControls } = await jiti.import("./DisplayControls.tsx");

function renderControls(variant) {
  return renderToStaticMarkup(React.createElement(DisplayControls, { variant }));
}

test("renders File Viewer as the fourth bounded font group in both Display presentations", () => {
  for (const variant of ["inline", "panel"]) {
    const html = renderControls(variant);
    const groupLabels = [...html.matchAll(/role="group" aria-label="([^"]+)"/g)].map((match) => match[1]);

    assert.deepEqual(groupLabels, [
      ...(variant === "inline" ? ["Display settings"] : []),
      "Chat width",
      "Transcript font size",
      "Menu font size",
      "File Viewer font size",
    ]);
    assert.match(html, /aria-label="Decrease file viewer font size"/);
    assert.match(html, /aria-label="Increase file viewer font size"/);
    assert.match(html, /File Viewer font size in pixels/);
    assert.match(
      html,
      /min="10" max="32" step="1" value="14"/,
      "the viewer input exposes its approved default and bounds",
    );
    assert.match(
      html,
      variant === "inline" ? />File<\/span>/ : />File Viewer<\/span>/,
      "each responsive presentation has a visible viewer label",
    );
  }
});

test("hands the four-group control row to the panel before inline chrome can clip", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

  assert.match(
    css,
    /@container center-pane \(max-width: 1400px\)\s*\{[\s\S]*?\.display-controls-inline-wrap\s*\{\s*display: none;[\s\S]*?\.display-controls-popover-trigger\s*\{\s*display: flex;[\s\S]*?\.display-controls-panel\s*\{\s*display: grid;/,
  );
});
