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
  assert.match(panel, /onAddNodeEdge=\{addNodeEdge\}/);
  assert.match(panel, /nodeFormAssignments=\{nodeAssignments\}/);
  assert.match(panel, /direction=\{graphState\.direction\}/);
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
  assert.match(panel, /graphRequestRef\.current \+= 1;\s*setLoading\(false\);\s*const authorityAdopted = adoptGraphState\(authoritative\);\s*onAcceptedAuthority\?\.\(authorityAdopted\)/);
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
    panel.indexOf("const addNodeEdge", panel.indexOf("const insertEdge")),
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

test("Preview node quick-add revalidates the anchor and builds one existing add-edge operation in either direction", async () => {
  const panel = await read("./SessionDagPanel.tsx");
  const quickAdd = panel.slice(
    panel.indexOf("const addNodeEdge"),
    panel.indexOf("const pairKeyDown", panel.indexOf("const addNodeEdge")),
  );
  const beforeQueue = quickAdd.slice(0, quickAdd.indexOf("return runMutation"));
  assert.match(beforeQueue, /if \(enteredSessionId === anchorSessionId\)/);
  assert.match(beforeQueue, /Choose a different session ID; quick add must connect another node\./);
  assert.match(beforeQueue, /return Promise\.resolve\(\{ accepted: false, authorityAdopted: false \}\)/);
  assert.doesNotMatch(beforeQueue, /runMutation|fetch\(/);

  assert.match(quickAdd, /let authorityAdopted = false;\s*return runMutation\(\(state\) => \{/);
  assert.match(quickAdd, /const activeIds = new Set\(getActiveSessionIds\(state\)\)/);
  assert.match(quickAdd, /deriveSessionDagNodeFormAssignments\(state\)\.get\(anchorSessionId\)/);
  assert.match(quickAdd, /if \(!activeIds\.has\(anchorSessionId\) \|\| !formId\)/);
  assert.match(quickAdd, /type: "add_edge"/);
  assert.match(quickAdd, /edgeId: createClientEntityId\("edge"\)/);
  assert.match(quickAdd, /fromSessionId: direction === "incoming" \? enteredSessionId : anchorSessionId/);
  assert.match(quickAdd, /toSessionId: direction === "incoming" \? anchorSessionId : enteredSessionId/);
  assert.match(quickAdd, /\}, \(adopted\) => \{\s*authorityAdopted = adopted;\s*\}\)\.then\(\(accepted\) => \(\{\s*accepted,\s*authorityAdopted: accepted && authorityAdopted/);
  assert.equal((quickAdd.match(/runMutation\(/gu) ?? []).length, 1);
  assert.equal((quickAdd.match(/createClientEntityId\("edge"\)/gu) ?? []).length, 1);
  assert.doesNotMatch(quickAdd, /insert_edge|replace_edge|delete_edge/);
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
  assert.match(shell, /<SessionDagPanel[\s\S]*?active=\{dagPanelActive\}[\s\S]*?selectedSessionId=\{selectedSession\?\.id \?\? null\}[\s\S]*?onSelectSession=\{handleDagSelectSession\}/);
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

test("Preview go-to controls resolve exact current metadata through the existing selection owner", async () => {
  const [shell, panel, preview, svg] = await Promise.all([
    read("./AppShell.tsx"),
    read("./SessionDagPanel.tsx"),
    read("./SessionDagPreview.tsx"),
    read("../lib/session-dag-svg.ts"),
  ]);

  const selectionOwner = shell.slice(
    shell.indexOf("const handleSelectSession"),
    shell.indexOf("const handleNewSession", shell.indexOf("const handleSelectSession")),
  );
  assert.match(selectionOwner, /sessionViews\.prepareSelection\(session\.id\)/);
  assert.match(selectionOwner, /setSelectedSession\(session\)/);
  assert.match(selectionOwner, /router\.replace\(`\?session=\$\{encodeURIComponent\(session\.id\)\}`/);
  assert.doesNotMatch(selectionOwner, /setRightPanelOpen|setActiveRightPanelTabId|setFileViewerExpansion/);
  const dagSelectionOwner = shell.slice(
    shell.indexOf("const handleDagSelectSession"),
    shell.indexOf("const handleNewSession", shell.indexOf("const handleDagSelectSession")),
  );
  assert.match(dagSelectionOwner, /setSidebarExplicitSessionOpenRequest\(\{/);
  assert.match(dagSelectionOwner, /sessionId: session\.id/);
  assert.match(dagSelectionOwner, /handleSelectSession\(session\)/);
  assert.doesNotMatch(dagSelectionOwner, /setRightPanelOpen|setActiveRightPanelTabId|setFileViewerExpansion/);
  assert.match(shell, /<SessionSidebar[\s\S]*?explicitSessionOpenRequest=\{sidebarExplicitSessionOpenRequest\}[\s\S]*?onExplicitSessionOpenApplied=\{handleSidebarExplicitSessionOpenApplied\}/);
  assert.match(shell, /<SessionDagPanel[\s\S]*?onSelectSession=\{handleDagSelectSession\}/);

  assert.match(panel, /onSelectSession: \(session: SessionInfo\) => void/);
  assert.match(panel, /const sessionsById = useMemo\(\(\) => new Map\(sessions\.map\(\(session\) => \[session\.id, session\]\)\), \[sessions\]\)/);
  assert.match(panel, /const availableSessionIds = useMemo\(\(\) => new Set\(sessionsById\.keys\(\)\), \[sessionsById\]\)/);
  assert.match(panel, /const goToSession = useCallback\(\(sessionId: string\) => \{\s*const session = sessionsById\.get\(sessionId\);\s*if \(session\) onSelectSession\(session\)/);
  assert.match(panel, /<SessionDagPreview[\s\S]*?availableSessionIds=\{availableSessionIds\}[\s\S]*?onGoToSession=\{goToSession\}/);
  assert.doesNotMatch(panel.slice(
    panel.indexOf("const goToSession"),
    panel.indexOf("const projectPrefixes", panel.indexOf("const goToSession")),
  ), /fetch\(|runMutation|setSessions|sidebar/i);

  assert.match(preview, /availableSessionIds: ReadonlySet<string>/);
  assert.match(preview, /onGoToSession: \(sessionId: string\) => void/);
  assert.match(preview, /const onGoToSessionRef = useRef\(onGoToSession\);\s*onGoToSessionRef\.current = onGoToSession/);
  assert.match(preview, /const available = availableSessionIds\.has\(anchorSessionId\)/);
  assert.match(preview, /if \(available\) \{\s*const goToControl = createSessionDagGoToControl\(container\.ownerDocument, label\)/);
  assert.match(preview, /const goToLocalPosition = getSessionDagGoToControlLocalPosition\(bounds, direction\)/);
  assert.match(preview, /goToLocalPosition\.x,[\s\S]*?goToLocalPosition\.y/);
  assert.match(preview, /bindGoToActivation\(goToControl, \(\) => onGoToSessionRef\.current\(anchorSessionId\)\)/);
  assert.match(preview, /goToControlsRef\.current = goToControls/);
  assert.match(preview, /goToControlsRef\.current\.values\(\)[\s\S]*?path\.includes\(control\)/);
  assert.match(preview, /control\.addEventListener\("click"[\s\S]*?event\.stopPropagation\(\);\s*activateControl\(\)/);
  assert.match(preview, /control\.addEventListener\("keydown"[\s\S]*?event\.key !== "Enter" && event\.key !== " "[\s\S]*?event\.repeat[\s\S]*?event\.preventDefault\(\);\s*event\.stopPropagation\(\);\s*activateControl\(\)/);
  assert.doesNotMatch(preview, /setAttribute\("data-session-dag-[^"]*",\s*anchorSessionId/);

  const renderDependencies = /return \(\) => \{\s*cancelled = true;[\s\S]*?\};\s*\}, \[([\s\S]*?)\]\);\s*\n\s*useLayoutEffect/u.exec(preview);
  assert.ok(renderDependencies);
  assert.doesNotMatch(renderDependencies[1], /onGoToSession|selectedSessionId/);

  assert.match(svg, /export function createSessionDagGoToControl/);
  assert.match(svg, /export function getSessionDagGoToControlLocalPosition/);
  assert.match(svg, /control\.setAttribute\("aria-label", `Go to session \$\{label\}`\)/);
  assert.match(svg, /glyph\.setAttribute\("d", "M -5 0 H 2 M -1 -3 L 2 0 L -1 3 M 5 -5 V 5"\)/);
  assert.match(svg, /\.session-dag-go-to-control:focus/);
});

test("Preview keeps one trusted edge-or-node authoring interaction with recoverable focus and drafts", async () => {
  const [preview, svg] = await Promise.all([
    read("./SessionDagPreview.tsx"),
    read("../lib/session-dag-svg.ts"),
  ]);

  assert.match(preview, /if \(!container \|\| !active\) \{\s*clearPreparedRender\(\);\s*return;\s*\}/);
  assert.doesNotMatch(preview, /if \(!container \|\| !active\) \{[^}]*interactionRef\.current = null/);
  assert.match(preview, /enqueueMermaidOperation/);
  assert.match(preview, /securityLevel: "strict"/);
  assert.match(preview, /htmlLabels: false/);
  assert.match(preview, /prepareSessionDagSvg\([\s\S]*?rendered\.result\.svg[\s\S]*?rendered\.renderId/);
  assert.match(preview, /container\.shadowRoot \?\? container\.attachShadow\(\{ mode: "open" \}\)/);
  assert.match(preview, /trustedStyle\.textContent = SESSION_DAG_SHADOW_STYLES/);
  assert.match(preview, /stack\.replaceChildren\(prepared\.svg, controlLayer, insertOverlayLayer\)/);
  assert.match(preview, /renderRoot\.replaceChildren\(trustedStyle, stack\)/);
  assert.match(preview, /for \(const \[alias, edge\] of compiled\.edgesByAlias\)/);
  assert.match(preview, /for \(const anchorSessionId of compiled\.activeSessionIds\)/);
  assert.match(preview, /prepared\.edgePathsByAlias\.get\(alias\)/);
  assert.match(preview, /prepared\.nodeGroupsByAlias\.get\(alias\)/);
  assert.doesNotMatch(preview, /nodeGroup\.appendChild\(control\)|edgePath\.appendChild\(control\)/);

  assert.match(preview, /type PreviewInteraction = EdgeInteraction \| NodeInteraction/);
  assert.match(preview, /const interactionRef = useRef<PreviewInteraction \| null>\(null\)/);
  assert.match(preview, /kind: "edge"[\s\S]*?mode: "actions"[\s\S]*?focusTarget: "dot"/);
  assert.match(preview, /kind: "node"[\s\S]*?direction: null[\s\S]*?focusTarget: "input"/);
  assert.match(preview, /if \(current\?\.pending\) return/);
  assert.match(preview, /interactionRef\.current = null;\s*applyAllRecords\(\)/);
  assert.match(preview, /for \(const record of edgeControlRecordsRef\.current\.values\(\)\) record\.apply\(\);\s*for \(const record of nodeControlRecordsRef\.current\.values\(\)\) record\.apply\(\)/);
  assert.match(preview, /interactionMatchesEdgeRecord/);
  assert.match(preview, /interactionMatchesNodeRecord/);

  assert.match(preview, /createSessionDagEdgeActionControl\([\s\S]*?selfEdge,[\s\S]*?direction/);
  assert.match(preview, /getSessionDagEdgeMidpoint\(edgePath, prepared\.svg\)/);
  assert.match(preview, /interaction\.mode = "insert";\s*interaction\.focusTarget = "input"/);
  assert.match(preview, /updateSessionDagEdgeActionControl\(control, mode, pending\)/);
  assert.match(preview, /const selfEdge = edge\.fromSessionId === edge\.toSessionId/);
  assert.match(preview, /if \(!selfEdge\) \{[\s\S]*?onSwapRef\.current\(edge\)/);
  assert.match(preview, /onInsertRef\.current\(edge, interaction\.value\)/);

  assert.match(preview, /const formId = nodeFormAssignments\.get\(anchorSessionId\)/);
  assert.match(preview, /const minimumWidth = eligible \? 44 : 22/);
  assert.match(preview, /bounds\.width < minimumWidth \|\| bounds\.height < 22/);
  assert.match(preview, /validateSessionDagNodeControlGeometry\(bounds, direction, eligible, available\)/);
  assert.match(preview, /createSessionDagNodeAddControl\(container\.ownerDocument, label\)/);
  assert.match(preview, /bounds\.x \+ 11,[\s\S]*?bounds\.y \+ 11/);
  assert.match(preview, /bounds\.x \+ bounds\.width - 11/);
  assert.match(preview, /getSessionDagOverlayPosition\([\s\S]*?controlPosition\.x,[\s\S]*?controlPosition\.y/);
  assert.match(preview, /form\.setAttribute\("class", "session-dag-node-add-form"\)/);
  assert.match(preview, /input\.maxLength = SESSION_DAG_MAX_SESSION_ID_LENGTH/);
  assert.match(preview, /incoming\.textContent = "Incoming: ID → this node"/);
  assert.match(preview, /outgoing\.textContent = "Outgoing: this node → ID"/);
  assert.match(preview, /incoming\.type = "submit"/);
  assert.match(preview, /outgoing\.type = "submit"/);
  assert.match(preview, /input\.addEventListener\("keydown"[\s\S]*?if \(event\.key !== "Enter"\) return;\s*event\.preventDefault\(\);\s*event\.stopPropagation\(\)/);
  assert.match(preview, /const submitter = \(event as SubmitEvent\)\.submitter/);
  assert.match(preview, /submitter === incoming[\s\S]*?"incoming"[\s\S]*?submitter === outgoing[\s\S]*?"outgoing"/);
  assert.match(preview, /onAddNodeEdgeRef\.current\([\s\S]*?record\.anchorSessionId,[\s\S]*?interaction\.value,[\s\S]*?direction/);

  assert.match(preview, /interaction\.pending = true;\s*interaction\.direction = direction;\s*interaction\.focusTarget = direction/);
  assert.match(preview, /interaction\.pending = false;\s*interaction\.direction = direction;\s*interaction\.focusTarget = direction;\s*applyAllRecords\(\);\s*focusInteractionTarget\(\)/);
  assert.match(preview, /form\.setAttribute\("aria-busy", String\(pending\)\)/);
  assert.match(preview, /input\.readOnly = pending/);
  assert.match(preview, /if \(pending\) button\.setAttribute\("aria-disabled", "true"\)/);
  assert.doesNotMatch(preview, /input\.disabled = pending|incoming\.disabled = pending|outgoing\.disabled = pending/);
  assert.match(preview, /const nodeFocusRestoreRef = useRef/);
  assert.match(preview, /const deferFocusRestore = shouldDeferSessionDagNodeFocusRestore\([\s\S]*?authorityAdopted,[\s\S]*?currentRecord !== null,[\s\S]*?currentRecord === record/);
  assert.match(preview, /nodeFocusRestoreRef\.current = deferFocusRestore \? \{\s*anchorSessionId: record\.anchorSessionId,\s*formId: record\.formId/);
  assert.match(preview, /if \(record\?\.formId === focusRestore\.formId\) \{\s*queueMicrotask\(\(\) => focusElement\(record\.control\)\)/);
  assert.match(preview, /savedInteraction\?\.kind === "node"[\s\S]*?interactionMatchesNodeRecord\(savedInteraction, savedRecord\)/);

  assert.match(preview, /container\.ownerDocument\.addEventListener\("click", onDocumentClick, true\)/);
  assert.match(preview, /event\.composedPath\(\)/);
  assert.match(preview, /edgeControlRecordsRef\.current\.values\(\)[\s\S]*?nodeControlRecordsRef\.current\.values\(\)/);
  assert.match(preview, /if \(!interaction \|\| !activeForm \|\| interaction\.pending\) return/);
  assert.match(preview, /event\.key !== "Escape"/);
  assert.match(preview, /event\.key !== "Enter" && event\.key !== " "/);
  assert.match(preview, /event\.repeat/);
  assert.match(preview, /Raw remains available/);
  assert.doesNotMatch(preview, /dangerouslySetInnerHTML|data-render-key|setAttribute\("data-session-dag-[^"]*",\s*anchorSessionId/);

  assert.match(svg, /parseFromString\(svgMarkup, "image\/svg\+xml"\)/);
  assert.match(svg, /assertSafeSessionDagSvg\(svg, renderId\)/);
  assert.match(svg, /isSessionDagStyleSelectorScoped\(styleRule\.selectorText, renderId\)/);
  assert.match(svg, /hasReservedSessionDagAttribute\(attribute\.localName\)/);
  assert.match(svg, /validateSessionDagEdgeAliases/);
  assert.match(svg, /cyclic-special-mid/);
  assert.match(svg, /layer\.setAttribute\("class", "session-dag-control-layer"\)/);
  assert.match(svg, /createSessionDagNodeAddControl/);
  assert.match(svg, /session-dag-node-add-control/);
  assert.match(svg, /hitTarget\.setAttribute\("r", "14"\)/);
  assert.match(svg, /visibleDot\.setAttribute\("r", "5"\)/);
  assert.match(svg, /background\.setAttribute\("width", "48"\)/);
  assert.match(svg, /background\.setAttribute\("height", "22"\)/);
  assert.match(svg, /font-size: 9px/);
  assert.match(svg, /\.session-dag-node-add-form input:focus/);
  assert.match(svg, /\.session-dag-node-add-form\[aria-busy="true"\] input/);
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
