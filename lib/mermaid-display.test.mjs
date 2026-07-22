import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  buildMermaidRenderKey,
  enqueueMermaidOperation,
  mermaidDisplayConfig,
  normalizeMermaidFontSize,
} = await jiti.import("./mermaid-display.ts");

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
