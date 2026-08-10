import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  SESSION_DAG_CURRENT_NODE_ATTRIBUTE,
  SessionDagSvgError,
  getSessionDagNodeAlias,
  hasNestedSessionDagStyleRules,
  hasReservedSessionDagAttribute,
  hasReservedSessionDagClass,
  hasUnsafeSessionDagCss,
  isSessionDagStyleSelectorScoped,
  updateSessionDagCurrentNode,
} = await jiti.import("./session-dag-svg.ts");

const RENDER_ID = "session-dag-mermaid-12345678-1234-1234-1234-123456789abc";

function createMarkerNode() {
  const attributes = new Map();
  return {
    attributes,
    node: {
      setAttribute(name, value) { attributes.set(name, value); },
      removeAttribute(name) { attributes.delete(name); },
    },
  };
}

test("marks, replaces, and clears exactly one current-session node through existing maps", () => {
  const first = createMarkerNode();
  const second = createMarkerNode();
  const replacement = createMarkerNode();
  const compiled = {
    aliasesBySessionId: new Map([
      ["session-a", "n0"],
      ["session-b", "n1"],
    ]),
  };
  const prepared = {
    nodeGroupsByAlias: new Map([
      ["n0", first.node],
      ["n1", second.node],
    ]),
  };

  let marked = updateSessionDagCurrentNode(null, true, "session-a", compiled, prepared);
  assert.equal(marked, first.node);
  assert.equal(first.attributes.get(SESSION_DAG_CURRENT_NODE_ATTRIBUTE), "true");
  assert.equal(second.attributes.has(SESSION_DAG_CURRENT_NODE_ATTRIBUTE), false);

  marked = updateSessionDagCurrentNode(marked, true, "session-b", compiled, prepared);
  assert.equal(marked, second.node);
  assert.equal(first.attributes.has(SESSION_DAG_CURRENT_NODE_ATTRIBUTE), false);
  assert.equal(second.attributes.get(SESSION_DAG_CURRENT_NODE_ATTRIBUTE), "true");

  marked = updateSessionDagCurrentNode(marked, true, "not-rendered", compiled, prepared);
  assert.equal(marked, null);
  assert.equal(second.attributes.has(SESSION_DAG_CURRENT_NODE_ATTRIBUTE), false);

  marked = updateSessionDagCurrentNode(null, true, "session-a", compiled, prepared);
  const replacedPrepared = { nodeGroupsByAlias: new Map([["n0", replacement.node]]) };
  marked = updateSessionDagCurrentNode(marked, true, "session-a", compiled, replacedPrepared);
  assert.equal(marked, replacement.node);
  assert.equal(first.attributes.has(SESSION_DAG_CURRENT_NODE_ATTRIBUTE), false);
  assert.equal(replacement.attributes.get(SESSION_DAG_CURRENT_NODE_ATTRIBUTE), "true");

  for (const [active, selectedSessionId, currentCompiled, currentPrepared] of [
    [true, null, compiled, replacedPrepared],
    [false, "session-a", compiled, replacedPrepared],
    [true, "session-a", null, replacedPrepared],
    [true, "session-a", compiled, null],
    [true, "session-b", compiled, replacedPrepared],
  ]) {
    marked = updateSessionDagCurrentNode(
      marked,
      active,
      selectedSessionId,
      currentCompiled,
      currentPrepared,
    );
    assert.equal(marked, null);
    assert.equal(replacement.attributes.has(SESSION_DAG_CURRENT_NODE_ATTRIBUTE), false);
  }
});

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

test("accepts only current-root-contained Mermaid selectors outside trusted namespaces", () => {
  assert.equal(isSessionDagStyleSelectorScoped(`#${RENDER_ID}`, RENDER_ID), true);
  assert.equal(isSessionDagStyleSelectorScoped(`#${RENDER_ID} .node, #${RENDER_ID}>g`, RENDER_ID), true);
  assert.equal(isSessionDagStyleSelectorScoped("#target", RENDER_ID), false);
  assert.equal(isSessionDagStyleSelectorScoped(`#${RENDER_ID} + #target`, RENDER_ID), false);
  assert.equal(isSessionDagStyleSelectorScoped(`#${RENDER_ID} .session-dag-complete-control`, RENDER_ID), false);
  assert.equal(
    isSessionDagStyleSelectorScoped(`#${RENDER_ID} [class*="session-dag-current-node"]`, RENDER_ID),
    false,
  );
  assert.equal(
    isSessionDagStyleSelectorScoped(`#${RENDER_ID}:has([class~="session-dag-current-node"])`, RENDER_ID),
    false,
  );
  assert.equal(
    isSessionDagStyleSelectorScoped(`#${RENDER_ID} [class*="SESSION-DAG-" i]`, RENDER_ID),
    false,
  );
  assert.equal(
    isSessionDagStyleSelectorScoped(`#${RENDER_ID} [data-session-dag-current]`, RENDER_ID),
    false,
  );
  assert.equal(
    isSessionDagStyleSelectorScoped(`#${RENDER_ID}:has([DATA-SESSION-DAG-CURRENT])`, RENDER_ID),
    false,
  );
});

test("reserves trusted classes and marker attributes from generated Mermaid SVG", () => {
  assert.equal(hasReservedSessionDagClass("node default"), false);
  assert.equal(hasReservedSessionDagClass("session-dag"), false);
  assert.equal(hasReservedSessionDagClass("node session-dag-complete-layer default"), true);
  assert.equal(hasReservedSessionDagClass("SESSION-DAG-COMPLETE-CONTROL"), true);
  assert.equal(hasReservedSessionDagAttribute("class"), false);
  assert.equal(hasReservedSessionDagAttribute("data-session-dag"), false);
  assert.equal(hasReservedSessionDagAttribute("data-session-dag-current"), true);
  assert.equal(hasReservedSessionDagAttribute("DATA-SESSION-DAG-CURRENT"), true);
});

test("rejects nested style rules before trusted sibling controls are mounted", () => {
  assert.equal(hasNestedSessionDagStyleRules({}), false);
  assert.equal(hasNestedSessionDagStyleRules({ cssRules: { length: 0 } }), false);
  assert.equal(hasNestedSessionDagStyleRules({ cssRules: { length: 1 } }), true);
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
