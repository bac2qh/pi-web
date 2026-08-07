import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const {
  SessionUnreadAction,
  createSessionListGenerationTracker,
  isLatestSessionLoadRequest,
  resolveSidebarRunningSessionIds,
  shouldApplySidebarHttpRunningFallback,
} = await jiti.import("./SessionSidebar.tsx");

test("sidebar global status never acquires page session views or browser run ownership", async () => {
  const sidebarSource = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");
  assert.match(sidebarSource, /useGlobalStatus\(\)/);
  assert.doesNotMatch(sidebarSource, /useSessionViewTransport|SessionViewBinding|ensureVisible|beginPromptClaim/);
});

test("hosted session discovery reloads the ordinary list without navigation or selection", async () => {
  const [sidebarSource, channelSource] = await Promise.all([
    readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/global-status-channel.ts", import.meta.url), "utf8"),
  ]);

  assert.match(channelSource, /subscribeSessionListRefresh/);
  assert.match(channelSource, /sessionListGeneration/);
  assert.match(channelSource, /getSessionListRefreshGeneration/);
  const handler = sidebarSource.slice(
    sidebarSource.indexOf("subscribeSessionsChanged((event)"),
    sidebarSource.indexOf("}), [loadSessions, subscribeSessionsChanged]") + 60,
  );
  assert.match(handler, /tracker\.begin\(event\.sessionListGeneration\)/);
  assert.match(handler, /loadSessions\(false\)\.then\(\(applied\) => tracker\.finish\(event\.sessionListGeneration, applied\)\)/);
  assert.match(handler, /createSessionListGenerationTracker\(\)/);
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

test("the shared row exposes unread, rename, keyboard, touch, pin, hide, restore, and no permanent deletion", async () => {
  const [sidebarSource, cssSource, appShellSource] = await Promise.all([
    readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("./AppShell.tsx", import.meta.url), "utf8"),
  ]);
  const selectionControl = sidebarSource.slice(
    sidebarSource.indexOf('role="button"'),
    sidebarSource.indexOf('{/* Fork indicator for child sessions */}'),
  );
  assert.match(selectionControl, /tabIndex=\{0\}/);
  assert.match(selectionControl, /event\.key === "Enter" \|\| event\.key === " "/);
  assert.match(sidebarSource, /className="session-row-select"/);
  assert.match(sidebarSource, /<SessionUnreadAction/);
  assert.match(sidebarSource, /title="Rename"/);
  assert.match(sidebarSource, /aria-pressed=\{isPinned\}/);
  assert.match(sidebarSource, /className="session-row-actions"/);
  assert.match(sidebarSource, /hiddenKind === "explicit" \? `Restore/);
  assert.match(sidebarSource, /Hidden by parent/);
  assert.match(sidebarSource, /onHideChange=\{hiddenSessionKinds\.get\(node\.session\.id\) === "inherited"/);
  assert.match(sidebarSource, /const rowActionCount = onHideChange \? 3 : 2/);
  assert.match(sidebarSource, /const metadataActionPaddingRight = 25 \+ \(rowActionCount - 1\) \* 29/);
  assert.match(sidebarSource, /paddingRight: metadataActionPaddingRight/);
  assert.doesNotMatch(sidebarSource, /\bDelete\b/);
  assert.doesNotMatch(sidebarSource, /onDeleted|onSessionDeleted|confirmDelete|deleting|handleDelete/);
  assert.doesNotMatch(
    sidebarSource,
    /fetch\(`\/api\/sessions\/\$\{encodeURIComponent\(session\.id\)\}`,[\s\S]{0,100}method:\s*"DELETE"/,
  );
  assert.doesNotMatch(appShellSource, /handleSessionDeleted|onSessionDeleted/);
  assert.match(cssSource, /\.session-row:focus-within \.session-row-actions/);
  assert.match(cssSource, /any-pointer: coarse/);
  assert.match(cssSource, /\.session-row-compact-action:focus/);
});

test("the unread row action reports state, stops navigation, and synchronizes duplicate presentations", () => {
  let unread = false;
  let propagationStops = 0;
  const createAction = (presentation) => SessionUnreadAction({
    title: `Session in ${presentation}`,
    isUnread: unread,
    onUnreadChange: (nextIsUnread) => { unread = nextIsUnread; },
  });

  const markUnread = createAction("Pinned");
  assert.equal(markUnread.type, "button");
  assert.equal(markUnread.props.type, "button");
  assert.equal(markUnread.props.title, "Mark unread");
  assert.equal(markUnread.props["aria-label"], "Mark unread Session in Pinned");
  assert.equal(markUnread.props["aria-pressed"], undefined, "dynamic command names must not also claim toggle-button state");
  assert.match(markUnread.props.className, /session-row-action/);
  markUnread.props.onClick({ stopPropagation: () => { propagationStops += 1; } });
  assert.equal(propagationStops, 1);
  assert.equal(unread, true);

  const duplicateActions = ["Pinned", "Recent", "Project"].map(createAction);
  for (const action of duplicateActions) {
    assert.equal(action.props.title, "Mark read");
    assert.equal(action.props["aria-label"].startsWith("Mark read "), true);
    assert.equal(action.props["aria-pressed"], undefined);
  }
  duplicateActions[2].props.onClick({ stopPropagation: () => { propagationStops += 1; } });
  assert.equal(propagationStops, 2);
  assert.equal(unread, false);
});

test("manual unread uses one browser-local set across Pinned, Recent, and Project and every row open clears it", async () => {
  const [sidebarSource, routeSource] = await Promise.all([
    readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/sidebar-state/route.ts", import.meta.url), "utf8"),
  ]);
  assert.equal((sidebarSource.match(/onUnreadChange=\{handleUnreadChange\}/g) ?? []).length, 3);
  assert.ok((sidebarSource.match(/onUnreadChange=\{onUnreadChange\}/g) ?? []).length >= 2);
  const explicitOpenHandler = sidebarSource.slice(
    sidebarSource.indexOf("const handleSelectSessionFromList"),
    sidebarSource.indexOf("const handleUnreadChange"),
  );
  assert.match(explicitOpenHandler, /setSessionUnread\(prev, s\.id, false\)/);
  assert.ok(explicitOpenHandler.indexOf("setSessionUnread") < explicitOpenHandler.indexOf("onSelectSession(s)"));
  assert.match(sidebarSource, /from "@\/lib\/sidebar-unread-state"/);
  assert.doesNotMatch(routeSource, /unread/i);
});

test("WebSocket authority atomically suppresses a late HTTP fallback before passive effects", async () => {
  let fallbackRunningSessionIds = new Set(["still-running"]);
  let controllerSnapshot = { runningAuthoritative: false };
  let providerRunningSessionIds = [];
  let providerRunningAuthoritative = false;
  let releaseHttp;
  const delayedHttp = new Promise((resolve) => { releaseHttp = resolve; }).then((ids) => {
    if (shouldApplySidebarHttpRunningFallback(() => controllerSnapshot)) {
      fallbackRunningSessionIds = new Set(ids);
    }
  });

  // Controller delivery is synchronous, while React provider rendering/effects
  // may follow later. The async HTTP commit must already see socket authority.
  controllerSnapshot = { runningAuthoritative: true };
  releaseHttp([]);
  await delayedHttp;
  providerRunningSessionIds = ["still-running"];
  providerRunningAuthoritative = true;

  const displayed = resolveSidebarRunningSessionIds(
    fallbackRunningSessionIds,
    providerRunningSessionIds,
    providerRunningAuthoritative,
  );
  assert.deepEqual([...fallbackRunningSessionIds], ["still-running"]);
  assert.deepEqual([...displayed], ["still-running"]);
  const falseBackgroundCompletions = ["still-running"].filter((id) => !displayed.has(id));
  assert.deepEqual(falseBackgroundCompletions, []);
});

test("WebSocket authority uses provider running data and server instances reset generation namespace", async () => {
  const sidebarSource = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");
  const loadSessions = sidebarSource.slice(
    sidebarSource.indexOf("const loadSessions"),
    sidebarSource.indexOf("const initialLoadDone"),
  );
  assert.match(loadSessions, /shouldApplySidebarHttpRunningFallback\(getCurrentGlobalStatusSnapshot\)/);
  assert.match(sidebarSource, /resolveSidebarRunningSessionIds\([\s\S]*globalRunningSessionIds,[\s\S]*runningAuthoritative/);
  assert.doesNotMatch(sidebarSource, /streamAuthoritativeRef/);
  const namespaceEffect = sidebarSource.slice(
    sidebarSource.indexOf("if (!serverInstanceId) return"),
    sidebarSource.indexOf("subscribeSessionsChanged((event)"),
  );
  assert.match(namespaceEffect, /namespace\.serverInstanceId !== serverInstanceId/);
  assert.match(namespaceEffect, /tracker: createSessionListGenerationTracker\(\)/);
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
