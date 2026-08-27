import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

test("DAG panel keeps structured Raw authoring canonical and serializes mutations", async () => {
  const panel = await read("./SessionDagPanel.tsx");

  assert.match(panel, /type DagMode = "preview" \| "raw"/);
  assert.match(panel, /\["preview", "raw"\]/);
  assert.match(panel, /\["TD", "LR"\]/);
  assert.match(panel, /\n\s*Refresh\n/);
  assert.match(panel, /\n\s*Undo\n/);
  assert.match(panel, /\n\s*Redo\n/);
  assert.match(panel, /mode === "raw"[\s\S]*?>\s*Add form/);
  assert.match(panel, /From session ID/);
  assert.match(panel, /To session ID/);
  assert.match(panel, /event\.key === "Enter"/);
  assert.match(panel, /event\.key === "Escape"/);
  assert.match(panel, /type: "add_edge"/);
  assert.match(panel, /type: "replace_edge"/);
  assert.match(panel, /type: "insert_edge"/);
  assert.match(panel, /onSwap=\{swapEdge\}/);
  assert.match(panel, /onInsert=\{insertEdge\}/);
  assert.match(panel, /getSessionDagRawEndpointPresentation/);
  assert.match(panel, /data-state=\{fromPresentation\.status\}/);
  assert.match(panel, /data-state=\{trailingFromPresentation\.status\}/);
  assert.doesNotMatch(panel, /draft\.fromSessionId === edge\.fromSessionId/);
  assert.match(panel, /type: "delete_edge"/);
  assert.match(panel, /type: "complete"/);
  assert.match(panel, /<SessionDagPreview\s+active=\{active && mode === "preview"\}/);
  assert.match(panel, /selectedSessionId=\{selectedSessionId\}/);
  assert.match(panel, /try \{\s*return \{ compiled: compileSessionDag\(graphState, sessions\), error: null \}/);
  assert.match(panel, /\{!graphState \? \(/);
  assert.doesNotMatch(panel, /textarea|contentEditable|dangerouslySetInnerHTML/);
  assert.doesNotMatch(panel, /drag|drop|move_edge|isolated/i);

  assert.match(panel, /mutationQueueRef/);
  assert.match(panel, /mutationId, baseRevision: baseState\.revision, operation/);
  assert.match(panel, /for \(let attempt = 0; attempt < 2; attempt \+= 1\)[\s\S]*?value = await response\.json\(\)[\s\S]*?response = null/);
  assert.match(panel, /response\.status === 409[\s\S]*?adoptGraphState\(authoritative\)/);
  assert.match(panel, /responseErrorMessage\(value, "Graph changed elsewhere; review and retry"\)/);
  assert.match(panel, /Graph changed elsewhere; review and retry/);
  assert.match(panel, /reconcileDrafts\(incoming\)/);
  assert.match(panel, /graphRequestRef\.current \+= 1;\s*setLoading\(false\);\s*adoptGraphState\(authoritative\)/);
  assert.match(panel, /const current = graphStateRef\.current;\s*if \(current && incoming\.revision < current\.revision\) return false;[\s\S]*?reconcileDrafts\(incoming\)/);
  assert.match(panel, /source\?: "graph-load" \| "session-load"/);
  assert.match(panel, /current\?\.source === "graph-load" \? null : current/);
  assert.match(panel, /current\?\.source === "session-load" \? null : current/);
});

test("Raw Swap reverses displayed committed values atomically while trailing Swap stays local", async () => {
  const panel = await read("./SessionDagPanel.tsx");
  const committedSwap = panel.slice(
    panel.indexOf("const submitEdgeSwap"),
    panel.indexOf("const swapEdge", panel.indexOf("const submitEdgeSwap")),
  );
  assert.match(committedSwap, /const displayed = edgeDraftValue\(edgeDrafts, edge\)/);
  assert.match(committedSwap, /if \(displayed\.fromSessionId === displayed\.toSessionId\) return/);
  assert.match(committedSwap, /replaceEdge\(edge, \{\s*fromSessionId: displayed\.toSessionId,\s*toSessionId: displayed\.fromSessionId/);
  assert.match(committedSwap, /if \(accepted\) clearEdgeDraft\(edge\.id\)/);

  const replacement = panel.slice(
    panel.indexOf("const replaceEdge"),
    panel.indexOf("const clearEdgeDraft", panel.indexOf("const replaceEdge")),
  );
  assert.match(replacement, /const expected = createEdgeExpectation\(edge\)/);
  assert.match(replacement, /currentEdge\.formId !== expected\.formId/);
  assert.match(replacement, /currentEdge\.fromSessionId !== expected\.fromSessionId/);
  assert.match(replacement, /currentEdge\.toSessionId !== expected\.toSessionId/);
  assert.match(replacement, /type: "replace_edge"[\s\S]*?expected,[\s\S]*?next: nextPair/);

  const trailingSwapStart = panel.indexOf('title="Swap new dependency From and To values"');
  const trailingSwap = panel.slice(trailingSwapStart, panel.indexOf("</button>", trailingSwapStart));
  assert.match(trailingSwap, /setFormDrafts/);
  assert.match(trailingSwap, /fromSessionId: trailingDraft\.toSessionId/);
  assert.match(trailingSwap, /toSessionId: trailingDraft\.fromSessionId/);
  assert.doesNotMatch(trailingSwap, /runMutation|add_edge|replace_edge/);
  assert.match(panel, /disabled=\{busy \|\| trailingDraft\.fromSessionId === trailingDraft\.toSessionId\}/);
  assert.match(panel, /disabled=\{busy \|\| draft\.fromSessionId === draft\.toSessionId\}/);
});

test("Preview Insert builds one exact atomic operation with stable fresh IDs and selected-edge CAS", async () => {
  const panel = await read("./SessionDagPanel.tsx");
  const insertion = panel.slice(
    panel.indexOf("const insertEdge"),
    panel.indexOf("const pairKeyDown", panel.indexOf("const insertEdge")),
  );
  assert.match(insertion, /const expected = createEdgeExpectation\(edge\)/);
  assert.match(insertion, /const firstEdgeId = createClientEntityId\("edge"\)/);
  assert.match(insertion, /const secondEdgeId = createClientEntityId\("edge"\)/);
  assert.match(insertion, /currentEdge\.formId !== expected\.formId/);
  assert.match(insertion, /currentEdge\.fromSessionId !== expected\.fromSessionId/);
  assert.match(insertion, /currentEdge\.toSessionId !== expected\.toSessionId/);
  assert.match(insertion, /type: "insert_edge"[\s\S]*?edgeId: edge\.id[\s\S]*?expected,[\s\S]*?insertedSessionId,[\s\S]*?firstEdgeId,[\s\S]*?secondEdgeId/);
  assert.equal((insertion.match(/runMutation\(/gu) ?? []).length, 1);
});

test("DAG refresh and copy behavior stay separated from graph mutations", async () => {
  const panel = await read("./SessionDagPanel.tsx");

  assert.match(panel, /fetch\("\/api\/session-dag", \{ cache: "no-store" \}\)/);
  assert.match(panel, /fetch\("\/api\/sessions", \{ cache: "no-store" \}\)/);
  assert.match(panel, /window\.addEventListener\("focus", onFocus\)/);
  assert.match(panel, /window\.addEventListener\("online", onOnline\)/);
  assert.match(panel, /subscribeSessionsChanged\(\(\) => \{\s*void loadSessions\(\)/);
  assert.doesNotMatch(panel, /subscribeSessionsChanged[\s\S]{0,100}loadGraph/);
  assert.doesNotMatch(panel, /setInterval|EventSource|WebSocket/);

  assert.match(panel, /await copyText\(sessionId\)/);
  assert.match(panel, /Session ID copied\./);
  assert.match(panel, /Session ID could not be copied\./);
  assert.match(panel, /<code title=\{sessionId\}>\{sessionId\}<\/code>/);
  assert.match(panel, /session \? label : "Session unavailable"/);
});

test("selected chat session flows to a separate direct-map Preview marker", async () => {
  const [shell, panel, preview, svg] = await Promise.all([
    read("./AppShell.tsx"),
    read("./SessionDagPanel.tsx"),
    read("./SessionDagPreview.tsx"),
    read("../lib/session-dag-svg.ts"),
  ]);

  assert.match(shell, /const dagPanelActive = rightPanelOpen && activeRightPanelTabId === RIGHT_PANEL_DAG_TAB_ID/);
  assert.match(shell, /<SessionDagPanel[\s\S]*?active=\{dagPanelActive\}[\s\S]*?selectedSessionId=\{selectedSession\?\.id \?\? null\}/);
  assert.match(panel, /selectedSessionId: string \| null/);
  assert.match(panel, /<SessionDagPreview[\s\S]*?active=\{active && mode === "preview"\}[\s\S]*?selectedSessionId=\{selectedSessionId\}/);
  assert.match(preview, /const preparedRenderRef = useRef/);
  assert.match(preview, /const markedNodeRef = useRef<SVGGElement \| null>\(null\)/);
  assert.match(preview, /const currentSelectionRef = useRef\(\{ active, selectedSessionId \}\)/);
  assert.match(preview, /useLayoutEffect\(\(\) => \{\s*currentSelectionRef\.current = \{ active, selectedSessionId \}/);
  assert.doesNotMatch(preview, /const currentSelectionRef = useRef\([^\n]+\);\s*currentSelectionRef\.current/);
  assert.match(preview, /preparedRenderRef\.current = \{ compiled, prepared \}/);
  assert.match(preview, /updateSessionDagCurrentNode/);

  const renderDependencies = /return \(\) => \{\s*cancelled = true;[\s\S]*?\};\s*\}, \[([\s\S]*?)\]\);\s*\n\s*useLayoutEffect\(\(\) => \{\s*currentSelectionRef\.current = \{ active, selectedSessionId \};\s*const rendered = preparedRenderRef\.current/u.exec(preview);
  assert.ok(renderDependencies);
  assert.doesNotMatch(renderDependencies[1], /selectedSessionId/);
  assert.match(preview, /\}, \[active, selectedSessionId\]\);/);
  assert.match(preview, /buildMermaidRenderKey\(isDark, transcriptFontSize, compiled\.source\)/);

  const markerHelper = svg.slice(
    svg.indexOf("export function updateSessionDagCurrentNode"),
    svg.indexOf("export function getSessionDagNodeAlias"),
  );
  assert.match(markerHelper, /compiled\.aliasesBySessionId\.get\(selectedSessionId\)/);
  assert.match(markerHelper, /prepared\.nodeGroupsByAlias\.get\(alias\)/);
  assert.doesNotMatch(markerHelper, /querySelector|querySelectorAll|new Set|for \(/);
  assert.match(svg, /\[data-session-dag-current="true"\] > \.label-container \{[\s\S]*?fill: var\(--bg-selected\) !important;[\s\S]*?stroke: var\(--accent\) !important;/);
  assert.doesNotMatch(markerHelper, /focus\(|scroll|fetch|render|mermaid/i);
});

test("Preview keeps Mermaid inert while trusted edge dots own expansion, insertion, and recovery", async () => {
  const [preview, svg] = await Promise.all([
    read("./SessionDagPreview.tsx"),
    read("../lib/session-dag-svg.ts"),
  ]);

  assert.match(preview, /if \(!container \|\| !active\) \{\s*clearPreparedRender\(\);\s*return;\s*\}/);
  assert.doesNotMatch(preview, /if \(!container \|\| !active\) \{[^}]*edgeInteractionRef\.current = null/);
  assert.match(preview, /enqueueMermaidOperation/);
  assert.match(preview, /securityLevel: "strict"/);
  assert.match(preview, /htmlLabels: false/);
  assert.match(preview, /mermaid\.mermaidAPI\.parse/);
  assert.match(preview, /prepareSessionDagSvg\([\s\S]*?rendered\.result\.svg[\s\S]*?rendered\.renderId/);
  assert.match(preview, /container\.shadowRoot \?\? container\.attachShadow\(\{ mode: "open" \}\)/);
  assert.match(preview, /trustedStyle\.textContent = SESSION_DAG_SHADOW_STYLES/);
  assert.match(preview, /stack\.replaceChildren\(prepared\.svg, controlLayer, insertOverlayLayer\)/);
  assert.match(preview, /renderRoot\.replaceChildren\(trustedStyle, stack\)/);
  assert.match(preview, /insertOverlayLayer\.setAttribute\("class", "session-dag-edge-insert-overlay-layer"\)/);
  assert.match(preview, /for \(const \[alias, edge\] of compiled\.edgesByAlias\)/);
  assert.match(preview, /prepared\.edgePathsByAlias\.get\(alias\)/);
  assert.match(preview, /createSessionDagEdgeActionControl/);
  assert.match(preview, /getSessionDagEdgeMidpoint\(edgePath, prepared\.svg\)/);
  assert.match(preview, /getSessionDagOverlayPosition\(prepared\.svg, position\.x, position\.y\)/);
  assert.match(preview, /controlLayer\.appendChild\(control\.root\)/);
  assert.doesNotMatch(preview, /nodeGroup\.appendChild\(control\)|edgePath\.appendChild\(control\)/);

  assert.match(preview, /const edgeInteractionRef = useRef<EdgeInteraction \| null>\(null\)/);
  assert.match(preview, /if \(interactionMatchesRecord\(current, record\)\) \{\s*closeInteraction\(true\)/);
  assert.match(preview, /edgeInteractionRef\.current = \{[\s\S]*?mode: "actions"[\s\S]*?focusTarget: "dot"/);
  assert.match(preview, /interaction\.mode = "insert";\s*interaction\.focusTarget = "input"/);
  assert.match(preview, /updateSessionDagEdgeActionControl\(control, mode, pending\)/);
  assert.match(preview, /mode === "collapsed" \? "Show" : "Hide"/);
  assert.match(preview, /const selfEdge = edge\.fromSessionId === edge\.toSessionId/);
  assert.match(preview, /if \(!selfEdge\) \{[\s\S]*?onSwapRef\.current\(edge\)/);
  assert.match(preview, /bindEdgeActivation\(control\.insert,[\s\S]*?interaction\.mode = "insert"/);

  assert.match(preview, /form\.setAttribute\("class", "session-dag-edge-insert-form"\)/);
  assert.match(preview, /input\.maxLength = SESSION_DAG_MAX_SESSION_ID_LENGTH/);
  assert.match(preview, /input\.autofocus = true/);
  assert.match(preview, /input\.addEventListener\("input"[\s\S]*?interaction\.value = input\.value/);
  assert.match(preview, /form\.setAttribute\("aria-busy", String\(pending\)\)/);
  assert.match(preview, /input\.readOnly = pending/);
  assert.match(preview, /if \(pending\) button\.setAttribute\("aria-disabled", "true"\)/);
  assert.doesNotMatch(preview, /input\.disabled = pending|submit\.disabled = pending|cancel\.disabled = pending/);
  assert.match(preview, /form\.addEventListener\("submit"[\s\S]*?onInsertRef\.current\(edge, interaction\.value\)/);
  assert.match(preview, /cancel\.addEventListener\("click"[\s\S]*?closeInteraction\(true\)/);
  assert.match(preview, /event\.key !== "Escape"/);
  assert.match(preview, /event\.key !== "Enter" && event\.key !== " "/);
  assert.match(preview, /event\.repeat/);
  assert.match(preview, /container\.ownerDocument\.addEventListener\("click", onDocumentClick, true\)/);
  assert.match(preview, /removeEventListener\("click", onDocumentClick, true\)/);
  assert.match(preview, /event\.composedPath\(\)/);
  assert.match(preview, /if \(!interaction \|\| !activeRecord \|\| interaction\.pending\) return/);
  assert.match(preview, /interaction\.pending = false;\s*interaction\.focusTarget = focusTarget;\s*applyAllRecords\(\);\s*focusInteractionTarget\(\)/);
  assert.match(preview, /const settleAcceptedEdgeMutation[\s\S]*?edgeInteractionRef\.current = null;[\s\S]*?focusElement\(currentRecord\?\.control\.dot \?\? null\)/);
  assert.match(preview, /if \(accepted\) settleAcceptedEdgeMutation\(record\);\s*else settleRejectedEdgeMutation/);
  assert.doesNotMatch(preview, /settleRejectedEdgeMutation[\s\S]{0,300}interaction\.value\s*=/);
  assert.match(preview, /savedRecord \|\| !interactionMatchesRecord\(savedInteraction, savedRecord\)/);
  assert.match(preview, /focusElement\(record\?\.control\.dot \?\? null\)/);

  assert.match(preview, /bounds\.width < 22 \|\| bounds\.height < 22/);
  assert.match(preview, /bounds\.x \+ bounds\.width - 11/);
  assert.match(preview, /Raw remains available/);
  assert.match(preview, /stage: "compile"/);
  assert.match(preview, /compileError/);
  assert.doesNotMatch(preview, /dangerouslySetInnerHTML|data-render-key|sessionId\}\s*data-/);

  assert.match(svg, /parseFromString\(svgMarkup, "image\/svg\+xml"\)/);
  assert.match(svg, /assertSafeSessionDagSvg\(svg, renderId\)/);
  assert.match(svg, /FORBIDDEN_SVG_ELEMENTS/);
  assert.match(svg, /isSessionDagStyleSelectorScoped\(styleRule\.selectorText, renderId\)/);
  assert.match(svg, /hasReservedSessionDagAttribute\(attribute\.localName\)/);
  assert.match(svg, /svg\.setAttribute\("role", "group"\)/);
  assert.match(svg, /validateSessionDagEdgeAliases/);
  assert.match(svg, /cyclic-special-mid/);
  assert.match(svg, /edgePathsByAlias/);
  assert.match(svg, /layer\.setAttribute\("class", "session-dag-control-layer"\)/);
  assert.match(svg, /element\.getScreenCTM\(\)/);
  assert.match(svg, /edgePath\.getPointAtLength\(length \/ 2\)/);
  assert.match(svg, /createSessionDagEdgeActionControl/);
  assert.match(svg, /session-dag-edge-action-dot/);
  assert.match(svg, /`Show actions for dependency from \$\{fromLabel\} to \$\{toLabel\}`/);
  assert.match(svg, /`Insert a session into dependency from \$\{fromLabel\} to \$\{toLabel\}`/);
  assert.match(svg, /updateSessionDagEdgeActionControl/);
  assert.match(svg, /control\.swap\.getAttribute\("aria-disabled"\) !== "true"/);
  assert.match(svg, /getSessionDagOverlayPosition/);
  assert.match(svg, /\.session-dag-edge-action-dot:focus/);
  assert.match(svg, /\.session-dag-edge-insert-form input:focus/);
  assert.match(svg, /\.session-dag-edge-insert-form\[aria-busy="true"\] input/);
  assert.match(svg, /\.session-dag-edge-insert-form button\[aria-disabled="true"\]/);
  assert.doesNotMatch(svg, /dangerouslySetInnerHTML|innerHTML|insertAdjacentHTML|\.onclick\s*=|__sessionDagDebug/);
});

test("DAG styles preserve responsive panel behavior and explicit focus states", async () => {
  const css = await read("../app/globals.css");

  assert.match(css, /\.session-dag-panel\s*\{[\s\S]*?height: 100%/);
  assert.match(css, /\.session-dag-toolbar\s*\{[\s\S]*?overflow-x: auto/);
  assert.match(css, /\.session-dag-mode-panel\[hidden\]/);
  assert.match(css, /\.session-dag-preview\s*\{[\s\S]*?overflow: auto/);
  assert.match(css, /\.session-dag-edge-row\s*\{[\s\S]*?grid-template-columns/);
  assert.match(css, /\.session-dag-edge-session-label\s*\{[\s\S]*?overflow-wrap: anywhere/);
  assert.match(css, /\.session-dag-edge-swap\s*\{[\s\S]*?color: var\(--accent\)/);
  assert.match(css, /\.session-dag-edge-actions\s*\{[\s\S]*?display: inline-flex/);
  assert.match(css, /@media \(max-width: 420px\)[\s\S]*?\.session-dag-edge-actions\s*\{[\s\S]*?grid-column: 2/);
  assert.match(css, /\.session-dag-node-text code\s*\{[\s\S]*?overflow-wrap: anywhere/);
  assert.match(css, /@media \(min-width: 641px\)[\s\S]*?\.right-panel-container\.right-panel-expanded/);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*?\.right-panel-container\.right-panel-open\s*\{[\s\S]*?width: 100%/);
});
