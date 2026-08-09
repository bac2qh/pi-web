import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  SessionDagSvgError,
  getSessionDagNodeAlias,
  hasUnsafeSessionDagCss,
  isSessionDagStyleSelectorScoped,
} = await jiti.import("./session-dag-svg.ts");

const RENDER_ID = "session-dag-mermaid-12345678-1234-1234-1234-123456789abc";

test("recognizes only supported Mermaid node alias encodings for the current render", () => {
  assert.equal(getSessionDagNodeAlias("n0", null, RENDER_ID), "n0");
  assert.equal(getSessionDagNodeAlias(null, "n1", RENDER_ID), "n1");
  assert.equal(getSessionDagNodeAlias(null, "flowchart-n2-17", RENDER_ID), "n2");
  assert.equal(
    getSessionDagNodeAlias(null, `${RENDER_ID}-flowchart-n3-4`, RENDER_ID),
    "n3",
  );

  assert.equal(
    getSessionDagNodeAlias(null, `another-render-flowchart-n3-4`, RENDER_ID),
    null,
  );
  assert.equal(getSessionDagNodeAlias(null, "prefix-n3-4", RENDER_ID), null);
  assert.equal(getSessionDagNodeAlias(null, "flowchart-node-4", RENDER_ID), null);
});

test("rejects escaped or externally loading CSS before SVG mount", () => {
  const gradientId = `${RENDER_ID}-gradient`;
  const allowedLocalReferences = new Set([gradientId]);

  assert.equal(hasUnsafeSessionDagCss("fill: #fff"), false);
  assert.equal(hasUnsafeSessionDagCss("@keyframes dash { to { opacity: 1 } }", true), false);
  assert.equal(hasUnsafeSessionDagCss(`stroke: url("#${gradientId}")`, false, allowedLocalReferences), false);
  assert.equal(hasUnsafeSessionDagCss(`stroke: url(#${gradientId})`, false, allowedLocalReferences), false);
  assert.equal(hasUnsafeSessionDagCss("stroke: url(\"#another-gradient\")", false, allowedLocalReferences), true);
  assert.equal(hasUnsafeSessionDagCss(String.raw`background:u\72l(h\74tps://example.invalid/leak)`), true);
  assert.equal(hasUnsafeSessionDagCss('background-image: image-set("/leak" 1x)'), true);
  assert.equal(hasUnsafeSessionDagCss("fill: var(--outside)"), true);
  assert.equal(hasUnsafeSessionDagCss("@import 'external.css'", true), true);
});

test("accepts only current-root-contained Mermaid selectors", () => {
  assert.equal(isSessionDagStyleSelectorScoped(`#${RENDER_ID}`, RENDER_ID), true);
  assert.equal(isSessionDagStyleSelectorScoped(`#${RENDER_ID} .node, #${RENDER_ID}>g`, RENDER_ID), true);
  assert.equal(isSessionDagStyleSelectorScoped("#target", RENDER_ID), false);
  assert.equal(isSessionDagStyleSelectorScoped(`#${RENDER_ID} + #target`, RENDER_ID), false);
  assert.equal(isSessionDagStyleSelectorScoped(`#${RENDER_ID} .session-dag-complete-control`, RENDER_ID), false);
});

test("rejects conflicting data and id aliases", () => {
  assert.throws(
    () => getSessionDagNodeAlias("n0", `${RENDER_ID}-flowchart-n1-1`, RENDER_ID),
    (error) => error instanceof SessionDagSvgError && error.stage === "aliases",
  );
  assert.throws(
    () => getSessionDagNodeAlias("", `${RENDER_ID}-flowchart-n0-0`, RENDER_ID),
    (error) => error instanceof SessionDagSvgError && error.stage === "aliases",
  );
});
