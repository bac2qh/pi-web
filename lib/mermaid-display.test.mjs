import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  buildMermaidRenderKey,
  buildMermaidViewStateKey,
  enqueueMermaidOperation,
  getMermaidModeState,
  mermaidDisplayConfig,
  normalizeMermaidFontSize,
} = await jiti.import("./mermaid-display.ts");

test("builds content-free stable state keys for Mermaid fences", () => {
  const first = buildMermaidViewStateKey("completed-text:100:2", { offset: 12, line: 3, column: 1 });

  assert.equal(first, "completed-text:100:2:mermaid-offset:12");
  assert.equal(
    buildMermaidViewStateKey("completed-text:100:2", { line: 3, column: 1 }),
    "completed-text:100:2:mermaid-position:3:1",
  );
  assert.notEqual(first, buildMermaidViewStateKey("completed-text:100:2", { offset: 30 }));
  assert.notEqual(first, buildMermaidViewStateKey("completed-text:101:2", { offset: 12 }));
  assert.equal(buildMermaidViewStateKey(undefined, { offset: 12 }), undefined);
  assert.equal(buildMermaidViewStateKey("completed-text:100:2", undefined), undefined);
});

test("defaults completed Mermaid blocks to Preview", () => {
  assert.deepEqual(getMermaidModeState(), {
    effectiveView: "preview",
    action: {
      destination: "source",
      label: "Source",
      title: "Show Mermaid source",
      disabled: false,
    },
  });
});

test("forces Source and disables Preview while streaming", () => {
  for (const selectedView of ["preview", "source"]) {
    assert.deepEqual(getMermaidModeState(selectedView, true), {
      effectiveView: "source",
      action: {
        destination: "preview",
        label: "Preview",
        title: "Preview available after streaming",
        disabled: true,
      },
    });
  }
});

test("keeps an explicit completed Mermaid selection authoritative", () => {
  const source = getMermaidModeState("source", false);
  const preview = getMermaidModeState("preview", false);

  assert.equal(source.effectiveView, "source");
  assert.equal(source.action.destination, "preview");
  assert.equal(preview.effectiveView, "preview");
  assert.equal(preview.action.destination, "source");
});

test("uses the bounded transcript size in Mermaid configuration", () => {
  assert.deepEqual(mermaidDisplayConfig(22), { fontSize: 22 });
  assert.deepEqual(mermaidDisplayConfig(99), { fontSize: 32 });
  assert.equal(normalizeMermaidFontSize(4), 10);
});

test("changes the Mermaid render key for theme, font size, and source", () => {
  const original = buildMermaidRenderKey(false, 16, "flowchart LR\nA-->B");
  assert.notEqual(original, buildMermaidRenderKey(false, 22, "flowchart LR\nA-->B"));
  assert.notEqual(original, buildMermaidRenderKey(true, 16, "flowchart LR\nA-->B"));
  assert.notEqual(original, buildMermaidRenderKey(false, 16, "flowchart LR\nA-->C"));
});

test("serializes Mermaid operations without poisoning later renders", async () => {
  const events = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });

  const first = enqueueMermaidOperation(async () => {
    events.push("first:start");
    await firstGate;
    events.push("first:end");
    return 1;
  });
  const second = enqueueMermaidOperation(async () => {
    events.push("second");
    return 2;
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ["first:start"]);
  releaseFirst();
  assert.deepEqual(await Promise.all([first, second]), [1, 2]);
  assert.deepEqual(events, ["first:start", "first:end", "second"]);

  await assert.rejects(enqueueMermaidOperation(async () => {
    throw new Error("expected test failure");
  }));
  assert.equal(await enqueueMermaidOperation(async () => 3), 3);
});
