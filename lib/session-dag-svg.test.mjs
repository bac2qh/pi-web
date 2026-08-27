import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  SESSION_DAG_CURRENT_NODE_ATTRIBUTE,
  SessionDagSvgError,
  createSessionDagEdgeActionControl,
  getSessionDagEdgeAlias,
  getSessionDagEdgeMidpoint,
  getSessionDagOverlayPosition,
  getSessionDagNodeAlias,
  hasNestedSessionDagStyleRules,
  hasReservedSessionDagAttribute,
  hasReservedSessionDagClass,
  hasUnsafeSessionDagCss,
  isSessionDagStyleSelectorScoped,
  updateSessionDagCurrentNode,
  updateSessionDagEdgeActionControl,
  validateSessionDagEdgeAliases,
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

function createFakeSvgDocument() {
  return {
    createElementNS(namespaceURI, localName) {
      const attributes = new Map();
      return {
        namespaceURI,
        localName,
        attributes,
        children: [],
        textContent: "",
        setAttribute(name, value) { attributes.set(name, value); },
        getAttribute(name) { return attributes.get(name) ?? null; },
        removeAttribute(name) { attributes.delete(name); },
        appendChild(child) { this.children.push(child); return child; },
      };
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

test("accepts exact current-render edge aliases and validates Mermaid self-edge segments", () => {
  const rendered = [
    { dataAlias: "e0", pathId: `${RENDER_ID}-e0` },
    { dataAlias: "e1", pathId: `${RENDER_ID}-e1` },
  ];
  const expected = [
    { edgeAlias: "e0", selfNodeAlias: null },
    { edgeAlias: "e1", selfNodeAlias: null },
  ];
  assert.equal(getSessionDagEdgeAlias("e0", `${RENDER_ID}-e0`, RENDER_ID), "e0");
  assert.deepEqual(
    [...validateSessionDagEdgeAliases(rendered, expected, RENDER_ID)],
    [["e0", 0], ["e1", 1]],
  );

  const selfRendered = ["1", "mid", "2"].map((suffix) => ({
    dataAlias: `n3-cyclic-special-${suffix}`,
    pathId: `${RENDER_ID}-n3-cyclic-special-${suffix}`,
  }));
  assert.deepEqual(
    [...validateSessionDagEdgeAliases(
      selfRendered,
      [{ edgeAlias: "e4", selfNodeAlias: "n3" }],
      RENDER_ID,
    )],
    [["e4", 1]],
    "the validated middle self-edge segment supplies control geometry",
  );

  for (const [invalidRendered, invalidExpected] of [
    [[rendered[0]], expected],
    [[rendered[0], rendered[0]], [expected[0]]],
    [[{ dataAlias: "e2", pathId: `${RENDER_ID}-e2` }], [expected[0]]],
    [[{ dataAlias: "persisted-edge", pathId: `${RENDER_ID}-persisted-edge` }], [expected[0]]],
    [[{ dataAlias: null, pathId: `${RENDER_ID}-e0` }], [expected[0]]],
    [[{ dataAlias: "e0", pathId: "another-render-e0" }], [expected[0]]],
    [selfRendered.slice(0, 2), [{ edgeAlias: "e4", selfNodeAlias: "n3" }]],
    [selfRendered, [{ edgeAlias: "e4", selfNodeAlias: "n4" }]],
  ]) {
    assert.throws(
      () => validateSessionDagEdgeAliases(invalidRendered, invalidExpected, RENDER_ID),
      (error) => error instanceof SessionDagSvgError && error.stage === "aliases",
    );
  }
});

test("converts a validated edge path midpoint into graph control coordinates and fails closed", () => {
  const graphSvg = {
    getScreenCTM() {
      return {
        inverse() { return { a: 1, b: 0, c: 0, d: 1, e: -4, f: -6 }; },
      };
    },
  };
  const edgePath = {
    getTotalLength() { return 20; },
    getPointAtLength(distance) {
      assert.equal(distance, 10);
      return { x: 2, y: 3 };
    },
    getScreenCTM() { return { a: 2, b: 0, c: 0, d: 2, e: 10, f: 20 }; },
  };
  assert.deepEqual(getSessionDagEdgeMidpoint(edgePath, graphSvg), { x: 10, y: 20 });

  for (const invalidPath of [
    { ...edgePath, getTotalLength() { return 0; } },
    { ...edgePath, getTotalLength() { return Number.NaN; } },
    { ...edgePath, getPointAtLength() { return { x: Number.POSITIVE_INFINITY, y: 0 }; } },
    { ...edgePath, getTotalLength() { throw new Error("geometry unavailable"); } },
    { ...edgePath, getScreenCTM() { return null; } },
  ]) {
    assert.throws(
      () => getSessionDagEdgeMidpoint(invalidPath, graphSvg),
      (error) => error instanceof SessionDagSvgError && error.stage === "controls",
    );
  }
});

test("builds trusted namespaced edge-action controls and disables only self-edge Swap", () => {
  const document = createFakeSvgDocument();
  const active = createSessionDagEdgeActionControl(document, "Repo · From", "Repo · To", false);
  assert.equal(active.root.namespaceURI, "http://www.w3.org/2000/svg");
  assert.equal(active.root.localName, "g");
  assert.equal(active.root.getAttribute("class"), "session-dag-edge-action-control");
  assert.equal(active.dot.getAttribute("role"), "button");
  assert.equal(active.dot.getAttribute("tabindex"), "0");
  assert.equal(active.dot.getAttribute("aria-expanded"), "false");
  assert.equal(
    active.dot.getAttribute("aria-label"),
    "Show actions for dependency from Repo · From to Repo · To",
  );
  assert.deepEqual(active.dot.children.map((child) => child.localName), ["circle", "circle"]);
  assert.equal(active.actions.getAttribute("display"), "none");
  assert.equal(active.swap.getAttribute("aria-disabled"), null);
  assert.equal(active.insert.getAttribute("aria-disabled"), null);
  assert.equal(active.swap.children[1].textContent, "Swap");
  assert.equal(active.insert.children[1].textContent, "Insert");

  updateSessionDagEdgeActionControl(active, "actions", false);
  assert.equal(active.dot.getAttribute("aria-expanded"), "true");
  assert.equal(active.actions.getAttribute("display"), null);
  assert.equal(active.actions.getAttribute("aria-hidden"), "false");
  assert.equal(active.swap.getAttribute("tabindex"), "0");
  assert.equal(active.insert.getAttribute("tabindex"), "0");

  updateSessionDagEdgeActionControl(active, "insert", true);
  assert.equal(active.dot.getAttribute("aria-expanded"), "true");
  assert.equal(active.dot.getAttribute("tabindex"), "-1");
  assert.equal(active.actions.getAttribute("display"), "none");
  assert.equal(active.root.getAttribute("data-session-dag-pending"), "true");
  updateSessionDagEdgeActionControl(active, "collapsed", false);
  assert.equal(active.dot.getAttribute("aria-expanded"), "false");
  assert.equal(active.root.getAttribute("data-session-dag-pending"), null);

  const selfEdge = createSessionDagEdgeActionControl(document, "Same", "Same", true);
  updateSessionDagEdgeActionControl(selfEdge, "actions", false);
  assert.equal(selfEdge.swap.getAttribute("aria-disabled"), "true");
  assert.equal(selfEdge.swap.getAttribute("tabindex"), "-1");
  assert.equal(selfEdge.insert.getAttribute("aria-disabled"), null);
  assert.equal(selfEdge.insert.getAttribute("tabindex"), "0");
});

test("converts validated graph points into bounded trusted HTML overlay percentages", () => {
  const graphSvg = {
    getAttribute(name) { return name === "viewBox" ? "10 20 200 100" : null; },
  };
  assert.deepEqual(
    getSessionDagOverlayPosition(graphSvg, 110, 45),
    { leftPercent: 50, topPercent: 25 },
  );
  for (const [svg, x, y] of [
    [{ getAttribute() { return null; } }, 0, 0],
    [{ getAttribute() { return "0 0 0 100"; } }, 0, 0],
    [graphSvg, 9, 20],
    [graphSvg, 10, 121],
    [graphSvg, Number.NaN, 20],
  ]) {
    assert.throws(
      () => getSessionDagOverlayPosition(svg, x, y),
      (error) => error instanceof SessionDagSvgError && error.stage === "controls",
    );
  }
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
