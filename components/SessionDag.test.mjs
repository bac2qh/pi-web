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
  assert.match(panel, /Graph changed elsewhere; review and retry/);
  assert.match(panel, /reconcileDrafts\(incoming\)/);
  assert.match(panel, /graphRequestRef\.current \+= 1;\s*setLoading\(false\);\s*adoptGraphState\(authoritative\)/);
  assert.match(panel, /const current = graphStateRef\.current;\s*if \(current && incoming\.revision < current\.revision\) return false;[\s\S]*?reconcileDrafts\(incoming\)/);
  assert.match(panel, /source\?: "graph-load" \| "session-load"/);
  assert.match(panel, /current\?\.source === "graph-load" \? null : current/);
  assert.match(panel, /current\?\.source === "session-load" \? null : current/);
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

test("Preview uses strict serialized Mermaid and fail-closed explicit controls", async () => {
  const [preview, svg] = await Promise.all([
    read("./SessionDagPreview.tsx"),
    read("../lib/session-dag-svg.ts"),
  ]);

  assert.match(preview, /if \(!container \|\| !active\) \{\s*clearPreparedRender\(\);\s*return;\s*\}/);
  assert.match(preview, /enqueueMermaidOperation/);
  assert.match(preview, /securityLevel: "strict"/);
  assert.match(preview, /htmlLabels: false/);
  assert.match(preview, /mermaid\.mermaidAPI\.parse/);
  assert.match(preview, /prepareSessionDagSvg\([\s\S]*?rendered\.result\.svg[\s\S]*?rendered\.renderId/);
  assert.match(preview, /container\.shadowRoot \?\? container\.attachShadow\(\{ mode: "open" \}\)/);
  assert.match(preview, /trustedStyle\.textContent = SESSION_DAG_SHADOW_STYLES/);
  assert.match(preview, /stack\.replaceChildren\(prepared\.svg, controlLayer\)/);
  assert.match(preview, /renderRoot\.replaceChildren\(trustedStyle, stack\)/);
  assert.match(preview, /controlLayer\.appendChild\(control\)/);
  assert.doesNotMatch(preview, /nodeGroup\.appendChild\(control\)/);
  assert.match(preview, /if \(inFlight\) return/);
  assert.match(preview, /event\.key !== "Enter" && event\.key !== " "/);
  assert.match(preview, /event\.repeat/);
  assert.match(preview, /bounds\.width < 22 \|\| bounds\.height < 22/);
  assert.match(preview, /bounds\.x \+ bounds\.width - 11/);
  assert.match(preview, /Raw remains available/);
  assert.match(preview, /stage: "compile"/);
  assert.match(preview, /compileError/);
  assert.doesNotMatch(preview, /dangerouslySetInnerHTML|data-render-key|sessionId\}\s*data-/);

  assert.match(svg, /parseFromString\(svgMarkup, "image\/svg\+xml"\)/);
  assert.match(svg, /parsedRoot\.namespaceURI !== SVG_NAMESPACE \|\| parsedRoot\.localName !== "svg"/);
  assert.match(svg, /svg\.getAttribute\("id"\) !== renderId/);
  assert.match(svg, /assertSafeSessionDagSvg\(svg, renderId\)/);
  assert.match(svg, /FORBIDDEN_SVG_ELEMENTS/);
  assert.match(svg, /styleElements\.length !== 1 \|\| styleElements\[0\]\.parentNode !== svg/);
  assert.match(svg, /isSessionDagStyleSelectorScoped\(styleRule\.selectorText, renderId\)/);
  assert.match(svg, /hasNestedSessionDagStyleRules\(styleRule\)/);
  assert.match(svg, /attribute\.localName === "class" && hasReservedSessionDagClass\(attribute\.value\)/);
  assert.match(svg, /hasReservedSessionDagAttribute\(attribute\.localName\)/);
  assert.match(svg, /attribute\.value\.includes\("\\\\"\)/);
  assert.match(svg, /titles\.length !== 1 \|\| descriptions\.length !== 1/);
  assert.match(svg, /svg\.setAttribute\("role", "group"\)/);
  assert.match(svg, /svg\.setAttribute\("aria-labelledby", titleId\)/);
  assert.match(svg, /svg\.setAttribute\("aria-describedby", descriptionId\)/);
  assert.doesNotMatch(svg, /svg\.setAttribute\("role", "img"\)/);
  assert.match(svg, /compiled\.sessionIdsByAlias\.has\(alias\)/);
  assert.match(svg, /nodeGroupsByAlias\.size !== compiled\.sessionIdsByAlias\.size/);
  assert.match(svg, /createElementNS\(SVG_NAMESPACE, "title"\)/);
  assert.match(svg, /tooltip\.textContent = sessionId/);
  assert.match(svg, /expectedGradientId = `\$\{renderId\}-gradient`/);
  assert.match(svg, /allowedLocalReferenceIds\.add\(expectedGradientId\)/);
  assert.match(svg, /propertyName === "fill" \|\| propertyName === "stroke"/);
  assert.match(svg, /layer\.setAttribute\("class", "session-dag-complete-layer"\)/);
  assert.match(svg, /layer\.setAttribute\("role", "group"\)/);
  assert.match(svg, /nodeGroup\.getScreenCTM\(\)/);
  assert.match(svg, /graphSvg\.getScreenCTM\(\)/);
  assert.match(svg, /createElementNS\(SVG_NAMESPACE, "g"\)/);
  assert.match(svg, /control\.setAttribute\("role", "button"\)/);
  assert.match(svg, /control\.setAttribute\("pointer-events", "all"\)/);
  assert.match(svg, /\.session-dag-complete-control:focus/);
  assert.doesNotMatch(svg, /dangerouslySetInnerHTML|innerHTML|insertAdjacentHTML|\.onclick\s*=|__sessionDagDebug/);
});

test("DAG styles preserve responsive panel behavior and explicit focus states", async () => {
  const css = await read("../app/globals.css");

  assert.match(css, /\.session-dag-panel\s*\{[\s\S]*?height: 100%/);
  assert.match(css, /\.session-dag-toolbar\s*\{[\s\S]*?overflow-x: auto/);
  assert.match(css, /\.session-dag-mode-panel\[hidden\]/);
  assert.match(css, /\.session-dag-preview\s*\{[\s\S]*?overflow: auto/);
  assert.match(css, /\.session-dag-edge-row\s*\{[\s\S]*?grid-template-columns/);
  assert.match(css, /\.session-dag-node-text code\s*\{[\s\S]*?overflow-wrap: anywhere/);
  assert.match(css, /@media \(min-width: 641px\)[\s\S]*?\.right-panel-container\.right-panel-expanded/);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*?\.right-panel-container\.right-panel-open\s*\{[\s\S]*?width: 100%/);
});
