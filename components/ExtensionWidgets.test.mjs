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
const {
  EditorAdjacentExtensionWidgets,
  ExtensionWidgets,
  EXTENSION_WIDGET_TRUNCATION_MARKER,
  MAX_EXTENSION_WIDGET_LINES,
  getExtensionWidgetDisplayLines,
  partitionExtensionWidgets,
} = await jiti.import("./ExtensionWidgets.tsx");

function renderWidgets(widgets) {
  return renderToStaticMarkup(React.createElement(ExtensionWidgets, { widgets }));
}

test("short, array-origin, and factory-origin widget lines share the same plain presentation", () => {
  const html = renderWidgets([
    { key: "array-origin", lines: ["array-one", "array-two"] },
    { key: "factory-origin", lines: ["factory-one", "factory-two"] },
  ]);

  assert.match(html, /array-origin/);
  assert.match(html, /array-one\narray-two/);
  assert.match(html, /factory-origin/);
  assert.match(html, /factory-one\nfactory-two/);
  assert.doesNotMatch(html, /widget truncated/);
  assert.ok(html.indexOf("array-origin") < html.indexOf("factory-origin"));
});

test("the Pi Web display policy keeps exactly ten logical lines without a marker", () => {
  const lines = Array.from({ length: MAX_EXTENSION_WIDGET_LINES }, (_, index) => `ten-${index + 1}`);
  const html = renderWidgets([{ key: "ten", lines }]);

  assert.equal(MAX_EXTENSION_WIDGET_LINES, 10);
  assert.match(html, /ten-10/);
  assert.doesNotMatch(html, /widget truncated/);
  assert.deepEqual(getExtensionWidgetDisplayLines(lines), lines);
});

test("the eleventh logical line is replaced by one truncation marker without mutating authority", () => {
  const lines = Array.from({ length: MAX_EXTENSION_WIDGET_LINES + 1 }, (_, index) => `eleven-${index + 1}`);
  const before = [...lines];
  const displayLines = getExtensionWidgetDisplayLines(lines);
  const html = renderWidgets([{ key: "eleven", lines }]);

  assert.deepEqual(lines, before, "presentation never truncates authoritative input");
  assert.equal(displayLines.length, MAX_EXTENSION_WIDGET_LINES + 1);
  assert.equal(displayLines.at(-1), EXTENSION_WIDGET_TRUNCATION_MARKER);
  assert.match(html, /eleven-10/);
  assert.doesNotMatch(html, /eleven-11/);
  assert.match(html, /\.\.\. \(widget truncated\)/);
});

test("unspecified placement defaults above and multiple widgets retain per-placement order", () => {
  const widgets = [
    { key: "default-above", lines: ["a"] },
    { key: "below-one", lines: ["b"], placement: "belowEditor" },
    { key: "explicit-above", lines: ["c"], placement: "aboveEditor" },
    { key: "below-two", lines: ["d"], placement: "belowEditor" },
  ];
  const partitioned = partitionExtensionWidgets(widgets);

  assert.deepEqual(partitioned.aboveEditor.map((widget) => widget.key), ["default-above", "explicit-above"]);
  assert.deepEqual(partitioned.belowEditor.map((widget) => widget.key), ["below-one", "below-two"]);
  assert.deepEqual(widgets.map((widget) => widget.key), ["default-above", "below-one", "explicit-above", "below-two"]);
});

test("empty and established composer seams both render above, editor, then below in one bounded region", () => {
  const branch = (name) => React.createElement(
    "section",
    { "data-branch": name },
    React.createElement(EditorAdjacentExtensionWidgets, {
      aboveEditor: React.createElement("div", { "data-order": `${name}-above` }, "above"),
      editor: React.createElement("div", { "data-order": `${name}-editor` }, "editor"),
      belowEditor: React.createElement("div", { "data-order": `${name}-below` }, "below"),
    }),
  );
  const html = renderToStaticMarkup(React.createElement("main", null, branch("empty"), branch("established")));

  for (const name of ["empty", "established"]) {
    const above = html.indexOf(`data-order=\"${name}-above\"`);
    const editor = html.indexOf(`data-order=\"${name}-editor\"`);
    const below = html.indexOf(`data-order=\"${name}-below\"`);
    assert.ok(above >= 0 && above < editor && editor < below, name);
  }
  assert.match(html, /max-height:min\(100dvh, 720px\)/);
  assert.match(html, /overflow:visible/);
  assert.match(html, /flex:0 0 auto/);
});

test("ChatWindow uses the shared scroll-bounded composition in both branches and not the transcript", async () => {
  const source = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
  const emptyBranchStart = source.indexOf("{isEmptyNew ? (");
  const establishedBranchStart = source.indexOf("\n      ) : (\n      <>", emptyBranchStart);
  const firstUse = source.indexOf("{editorWithExtensionWidgets}", emptyBranchStart);
  const secondUse = source.indexOf("{editorWithExtensionWidgets}", firstUse + 1);
  assert.ok(emptyBranchStart >= 0 && establishedBranchStart > emptyBranchStart);
  assert.ok(firstUse > emptyBranchStart && firstUse < establishedBranchStart, "empty branch uses the composer");
  assert.ok(secondUse > establishedBranchStart, "established branch uses the composer");
  assert.equal(source.indexOf("{editorWithExtensionWidgets}", secondUse + 1), -1);

  const transcriptStart = source.indexOf("ref={scrollContainerRef}");
  const transcriptEnd = source.indexOf("{isMobile ? null : (", transcriptStart);
  assert.ok(transcriptStart >= 0 && transcriptEnd > transcriptStart);
  assert.doesNotMatch(source.slice(transcriptStart, transcriptEnd), /ExtensionWidgets/);
  assert.match(source, /partitionExtensionWidgets\(extensionWidgets\)/);
  assert.match(source, /maxHeight: "min\(32dvh, 360px, max\(48px, calc\(100dvh - 336px\)\)\)"/);
  assert.match(source, /overflowY: "auto"/);
  assert.match(source, /className="my-auto w-full"/);
  assert.doesNotMatch(source.slice(emptyBranchStart, firstUse), /justify-center/);
});

test("short-height widget composition preserves bounded upward-opening editor menus", async () => {
  const source = await readFile(new URL("./ChatInput.tsx", import.meta.url), "utf8");
  const commandAndThinkingBound = /min\(56vh, 460px, max\(72px, calc\(100dvh - 216px\)\)\)/g;
  const fileBound = /min\(48vh, 400px, max\(72px, calc\(100dvh - 216px\)\)\)/g;
  assert.equal([...source.matchAll(commandAndThinkingBound)].length, 3);
  assert.equal([...source.matchAll(fileBound)].length, 2);
  assert.match(source, /overflowY: "auto", minWidth: 180/);
});
