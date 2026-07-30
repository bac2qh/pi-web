import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const {
  createSessionListGenerationTracker,
  isLatestSessionLoadRequest,
} = await jiti.import("./SessionSidebar.tsx");

test("hosted session discovery reloads the ordinary list without navigation or selection", async () => {
  const [sidebarSource, routeSource] = await Promise.all([
    readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/agent/running/events/route.ts", import.meta.url), "utf8"),
  ]);

  assert.match(routeSource, /subscribeSessionListRefresh/);
  assert.match(routeSource, /sessionListGeneration: generation/);
  assert.match(routeSource, /sessionListGeneration: getSessionListRefreshGeneration\(\)/);
  const handler = sidebarSource.slice(
    sidebarSource.indexOf("source.onmessage"),
    sidebarSource.indexOf("// On error EventSource auto-reconnects"),
  );
  assert.match(handler, /data\.type === "sessions_changed"/);
  assert.match(handler, /tracker\.begin\(generation\)/);
  assert.match(handler, /loadSessions\(false\)\.then\(\(applied\) => tracker\.finish\(generation, applied\)\)/);
  assert.doesNotMatch(handler, /onSelectSession|router\.|setSelectedSession|history\./);

  const loadSessions = sidebarSource.slice(
    sidebarSource.indexOf("const loadSessions"),
    sidebarSource.indexOf("const initialLoadDone"),
  );
  assert.ok(loadSessions.indexOf("isLatestSessionLoadRequest") < loadSessions.indexOf("setAllSessions"));
  assert.match(loadSessions, /finally \{\s*if \(isLatestSessionLoadRequest[\s\S]*setLoading\(false\)/);
});

test("a failed discovery load may retry the replayed generation", () => {
  const tracker = createSessionListGenerationTracker();

  assert.equal(tracker.begin(7), true);
  assert.equal(tracker.begin(7), false, "one generation must not overlap itself");
  tracker.finish(7, false);
  assert.equal(tracker.begin(7), true, "failure must leave the generation retryable");
  tracker.finish(7, true);
  assert.equal(tracker.begin(7), false, "a successfully applied generation stays consumed");
  assert.equal(tracker.begin(6), false, "an older replay cannot supersede applied discovery");
  assert.equal(tracker.begin(8), true);
  tracker.finish(8, true);
});

test("the sidebar composes fixed global sections before Project and a collapsed Explorer", async () => {
  const sidebarSource = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");
  const pinnedIndex = sidebarSource.indexOf('label="Pinned"');
  const recentIndex = sidebarSource.indexOf('label="Recent"');
  const projectIndex = sidebarSource.indexOf("<span>Project</span>");
  const explorerIndex = sidebarSource.indexOf("{/* File Explorer section */}");

  assert.ok(pinnedIndex > 0 && pinnedIndex < recentIndex);
  assert.ok(recentIndex < projectIndex && projectIndex < explorerIndex);
  assert.match(sidebarSource, /const \[explorerOpen, setExplorerOpen\] = useState\(false\)/);
  assert.match(sidebarSource, /aria-controls="sidebar-file-explorer"/);
  assert.match(sidebarSource, /Math\.min\(rowCount, 5\) \* 54/);
});

test("shared sidebar metadata stays operation-only, optimistic, and separate from session browsing", async () => {
  const [sidebarSource, routeSource] = await Promise.all([
    readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/sidebar-state/route.ts", import.meta.url), "utf8"),
  ]);

  assert.match(sidebarSource, /fetch\("\/api\/sidebar-state", \{ cache: "no-store" \}\)/);
  assert.match(sidebarSource, /pendingSidebarOperationsRef/);
  assert.match(sidebarSource, /replaySidebarStateOperations/);
  assert.match(sidebarSource, /setSidebarStateError/);
  assert.doesNotMatch(sidebarSource, /new EventSource\("\/api\/sidebar-state/);
  assert.doesNotMatch(sidebarSource, /setInterval\([^)]*sidebar/i);
  assert.match(routeSource, /parseSidebarStateOperation/);
  assert.match(routeSource, /updateSidebarState\(operation, sessions, \{ expectedSessionListGeneration: generation \}\)/);
  assert.doesNotMatch(routeSource, /pinnedSessionIds\s*[:=]\s*body|explicitlyHiddenSessionIds\s*[:=]\s*body/);
});

test("the shared row exposes keyboard, touch, pin, hide, restore, and hidden-state semantics", async () => {
  const [sidebarSource, cssSource] = await Promise.all([
    readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  const selectionControl = sidebarSource.slice(
    sidebarSource.indexOf('role="button"'),
    sidebarSource.indexOf('{/* Fork indicator for child sessions */}'),
  );
  assert.match(selectionControl, /tabIndex=\{0\}/);
  assert.match(selectionControl, /event\.key === "Enter" \|\| event\.key === " "/);
  assert.match(sidebarSource, /className="session-row-select"/);
  assert.match(sidebarSource, /aria-pressed=\{isPinned\}/);
  assert.match(sidebarSource, /className="session-row-actions"/);
  assert.match(sidebarSource, /hiddenKind === "explicit" \? `Restore/);
  assert.match(sidebarSource, /Hidden by parent/);
  assert.match(sidebarSource, /onHideChange=\{hiddenSessionKinds\.get\(node\.session\.id\) === "inherited"/);
  assert.match(cssSource, /\.session-row:focus-within \.session-row-actions/);
  assert.match(cssSource, /any-pointer: coarse/);
  assert.match(cssSource, /\.session-row-compact-action:focus/);
});

test("background completion refreshes activity-derived sections and successful metadata responses use revision authority", async () => {
  const sidebarSource = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");
  const metadataLoader = sidebarSource.slice(
    sidebarSource.indexOf("const loadSidebarState"),
    sidebarSource.indexOf("const processSidebarOperationQueue"),
  );
  assert.match(metadataLoader, /acceptAuthoritativeSidebarState\(current, state\)/);
  assert.doesNotMatch(metadataLoader, /requestId !== sidebarStateLoadRequestRef\.current/);

  const completionEffect = sidebarSource.slice(
    sidebarSource.indexOf("const completedInBackground"),
    sidebarSource.indexOf("previousRunningSessionIdsRef.current = runningSessionIds") + 70,
  );
  assert.match(completionEffect, /completedInBackground\.length > 0\) void loadSessions\(false\)/);
});

test("only the latest overlapping session-list response may update state", async () => {
  let latestRequestId = 0;
  const applied = [];
  const apply = async (requestId, value, gate) => {
    await gate;
    if (isLatestSessionLoadRequest(requestId, latestRequestId)) applied.push(value);
  };
  let releaseOld;
  let releaseNew;
  const oldGate = new Promise((resolve) => { releaseOld = resolve; });
  const newGate = new Promise((resolve) => { releaseNew = resolve; });
  const oldId = ++latestRequestId;
  const oldRequest = apply(oldId, "stale", oldGate);
  const newId = ++latestRequestId;
  const newRequest = apply(newId, "fresh", newGate);

  releaseNew();
  await newRequest;
  releaseOld();
  await oldRequest;
  assert.deepEqual(applied, ["fresh"]);
});
