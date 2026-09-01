import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  RECENT_SESSION_WINDOW_MS,
  acceptAuthoritativeSidebarState,
  applySidebarStateOperation,
  buildVisibleProjectSessionTree,
  canonicalizeExplicitHiddenSessionIds,
  createDefaultSidebarState,
  deriveRecentSessions,
  deriveSelectedSessionLineage,
  deriveShortestUniqueProjectPrefixes,
  deriveSidebarSessionLists,
  getEffectiveHiddenSessionKinds,
  getLineageSessionPrefix,
  getNextRecentExpiryAt,
  parseSidebarState,
  parseSidebarStateOperation,
  reconcileSidebarState,
  replaySidebarStateOperations,
} = await jiti.import("./sidebar-session-state.ts");

function session(id, modified = "2026-07-21T12:00:00.000Z", overrides = {}) {
  return {
    path: `/sessions/${id}.jsonl`,
    id,
    cwd: "/repos/app",
    created: modified,
    modified,
    messageCount: 2,
    firstMessage: `Session ${id}`,
    projectRoot: "/repos/app",
    ...overrides,
  };
}

function flattenTreeIds(nodes) {
  return nodes.flatMap((node) => [node.session.id, ...flattenTreeIds(node.children)]);
}

test("sidebar state validation is strict, bounded, and defaults are fresh", () => {
  const first = createDefaultSidebarState();
  const second = createDefaultSidebarState();
  first.pinnedSessionIds.push("one");
  assert.deepEqual(second, {
    version: 1,
    revision: 0,
    pinnedSessionIds: [],
    explicitlyHiddenSessionIds: [],
  });

  assert.deepEqual(parseSidebarState({
    version: 1,
    revision: 4,
    pinnedSessionIds: ["one"],
    explicitlyHiddenSessionIds: ["two"],
  }).pinnedSessionIds, ["one"]);
  assert.throws(() => parseSidebarState({ version: 2, revision: 0, pinnedSessionIds: [], explicitlyHiddenSessionIds: [] }));
  assert.throws(() => parseSidebarState({ version: 1, revision: 0, pinnedSessionIds: ["one", "one"], explicitlyHiddenSessionIds: [] }));
  assert.throws(() => parseSidebarState({ version: 1, revision: 0, pinnedSessionIds: [], explicitlyHiddenSessionIds: [], extra: true }));
  assert.throws(() => parseSidebarState({
    version: 1,
    revision: 0,
    pinnedSessionIds: Array.from({ length: 10_001 }, (_, index) => `session-${index}`),
    explicitlyHiddenSessionIds: [],
  }));
  assert.throws(() => parseSidebarStateOperation({ operation: "pin", sessionId: "x".repeat(513) }));
  assert.deepEqual(parseSidebarStateOperation({ operation: "pin", sessionId: "one" }), { operation: "pin", sessionId: "one" });
  assert.throws(() => parseSidebarStateOperation({ operation: "pin", sessionId: " one " }));
  assert.throws(() => parseSidebarStateOperation({ operation: "replace", sessionId: "one" }));
});

test("pin operations are newest-first, idempotent, and optimistic replay ignores stale authority", () => {
  const sessions = [session("one"), session("two")];
  const base = createDefaultSidebarState();
  const onePinned = applySidebarStateOperation(base, { operation: "pin", sessionId: "one" }, sessions);
  const twoPinned = applySidebarStateOperation(onePinned, { operation: "pin", sessionId: "two" }, sessions);
  assert.deepEqual(twoPinned.pinnedSessionIds, ["two", "one"]);
  assert.deepEqual(
    applySidebarStateOperation(twoPinned, { operation: "pin", sessionId: "two" }, sessions).pinnedSessionIds,
    ["two", "one"],
  );

  const confirmed = { ...onePinned, revision: 5 };
  const optimistic = replaySidebarStateOperations(confirmed, [
    { operation: "pin", sessionId: "two" },
    { operation: "unpin", sessionId: "one" },
  ], sessions);
  assert.deepEqual(optimistic.pinnedSessionIds, ["two"]);
  assert.equal(optimistic.revision, 5);
  assert.equal(acceptAuthoritativeSidebarState(confirmed, { ...base, revision: 4 }), confirmed);
  assert.deepEqual(acceptAuthoritativeSidebarState(confirmed, { ...twoPinned, revision: 6 }), { ...twoPinned, revision: 6 });
});

test("hiding closes over descendants without hiding ancestors or siblings and preserves pins", () => {
  const sessions = [
    session("root"),
    session("child", undefined, { parentSessionId: "root" }),
    session("grandchild", undefined, { parentSessionId: "child" }),
    session("sibling", undefined, { parentSessionId: "root" }),
  ];
  let state = { ...createDefaultSidebarState(), pinnedSessionIds: ["grandchild"] };
  state = applySidebarStateOperation(state, { operation: "hide", sessionId: "child" }, sessions);
  assert.deepEqual(state.explicitlyHiddenSessionIds, ["child"]);
  assert.deepEqual(state.pinnedSessionIds, ["grandchild"]);

  const hidden = getEffectiveHiddenSessionKinds(sessions, state.explicitlyHiddenSessionIds);
  assert.equal(hidden.get("child"), "explicit");
  assert.equal(hidden.get("grandchild"), "inherited");
  assert.equal(hidden.has("root"), false);
  assert.equal(hidden.has("sibling"), false);

  state = applySidebarStateOperation(state, { operation: "hide", sessionId: "root" }, sessions);
  assert.deepEqual(state.explicitlyHiddenSessionIds, ["root"], "an ancestor marker replaces redundant descendants");
  state = applySidebarStateOperation(state, { operation: "restore", sessionId: "root" }, sessions);
  assert.deepEqual(state.explicitlyHiddenSessionIds, []);
  assert.deepEqual(state.pinnedSessionIds, ["grandchild"]);
});

test("hidden closure covers future forks and terminates on cycles and missing parents", () => {
  const initial = [session("root"), session("child", undefined, { parentSessionId: "root" })];
  const state = applySidebarStateOperation(createDefaultSidebarState(), { operation: "hide", sessionId: "root" }, initial);
  const withFutureFork = [...initial, session("future", undefined, { parentSessionId: "child" })];
  assert.equal(getEffectiveHiddenSessionKinds(withFutureFork, state.explicitlyHiddenSessionIds).get("future"), "inherited");

  const cyclic = [
    session("a", undefined, { parentSessionId: "b" }),
    session("b", undefined, { parentSessionId: "a" }),
    session("orphan", undefined, { parentSessionId: "missing" }),
  ];
  const hidden = getEffectiveHiddenSessionKinds(cyclic, ["a"]);
  assert.equal(hidden.get("a"), "explicit");
  assert.equal(hidden.get("b"), "inherited");
  assert.equal(hidden.has("orphan"), false);
  assert.deepEqual(canonicalizeExplicitHiddenSessionIds(["a", "b"], cyclic), ["a"]);
  const selfCycle = [session("self", undefined, { parentSessionId: "self" })];
  assert.equal(getEffectiveHiddenSessionKinds(selfCycle, ["self"]).get("self"), "explicit");
  assert.deepEqual(buildVisibleProjectSessionTree(selfCycle).map((node) => node.session.id), ["self"]);
});

test("reconciliation prunes stale ids only from the supplied complete listing", () => {
  const state = {
    version: 1,
    revision: 9,
    pinnedSessionIds: ["kept", "missing"],
    explicitlyHiddenSessionIds: ["kept", "missing"],
  };
  const reconciled = reconcileSidebarState(state, [session("kept")]);
  assert.deepEqual(reconciled.pinnedSessionIds, ["kept"]);
  assert.deepEqual(reconciled.explicitlyHiddenSessionIds, ["kept"]);
  assert.equal(reconciled.revision, 9);
});

test("Recent uses the exact inclusive ten-day boundary, is uncapped, sorted, and schedules expiry", () => {
  const now = Date.parse("2026-07-21T12:00:00.000Z");
  const boundary = new Date(now - RECENT_SESSION_WINDOW_MS).toISOString();
  const justOutside = new Date(now - RECENT_SESSION_WINDOW_MS - 1).toISOString();
  const sessions = [
    ...Array.from({ length: 12 }, (_, index) => session(`recent-${index}`, new Date(now - index * 1000).toISOString())),
    session("boundary", boundary),
    session("outside", justOutside),
    session("invalid", "not-a-date"),
  ];
  const recent = deriveRecentSessions(sessions, ["recent-0"], now);
  assert.equal(recent.length, 12, "twelve unpinned sessions remain; there is no item cap");
  assert.equal(recent.some((item) => item.id === "boundary"), true);
  assert.equal(recent.some((item) => item.id === "outside"), false);
  assert.equal(recent.some((item) => item.id === "recent-0"), false);
  assert.equal(recent[0].id, "recent-1");
  assert.equal(getNextRecentExpiryAt(recent, now), Date.parse(boundary) + RECENT_SESSION_WINDOW_MS + 1);
});

test("hidden-first section derivation removes hidden pins and Recents unless Show hidden is enabled", () => {
  const now = Date.parse("2026-07-21T12:00:00.000Z");
  const sessions = [session("hidden"), session("visible")];
  const state = {
    version: 1,
    revision: 2,
    pinnedSessionIds: ["hidden"],
    explicitlyHiddenSessionIds: ["hidden"],
  };
  const normal = deriveSidebarSessionLists(sessions, state, false, now);
  assert.deepEqual(normal.pinnedSessions, []);
  assert.deepEqual(normal.recentSessions.map((item) => item.id), ["visible"]);
  const revealed = deriveSidebarSessionLists(sessions, state, true, now);
  assert.deepEqual(revealed.pinnedSessions.map((item) => item.id), ["hidden"]);
  assert.deepEqual(revealed.recentSessions.map((item) => item.id), ["visible"]);
  assert.equal(revealed.hiddenSessionKinds.get("hidden"), "explicit");
});

test("project prefixes use the shortest unique suffix", () => {
  const prefixes = deriveShortestUniqueProjectPrefixes([
    "/work/acme/app",
    "/work/other/app",
    "/tmp/tools",
    "/app",
  ]);
  assert.equal(prefixes.get("/work/acme/app"), "acme/app");
  assert.equal(prefixes.get("/work/other/app"), "other/app");
  assert.equal(prefixes.get("/tmp/tools"), "tools");
  assert.equal(prefixes.get("/app"), "/app");

  const windowsPrefixes = deriveShortestUniqueProjectPrefixes([
    "C:\\work\\alpha\\app",
    "D:\\work\\beta\\app",
  ]);
  assert.equal(windowsPrefixes.get("C:\\work\\alpha\\app"), "alpha/app");
  assert.equal(windowsPrefixes.get("D:\\work\\beta\\app"), "beta/app");
});

test("Project trees preserve ancestry and promote families by newest visible descendant", () => {
  const sessions = [
    session("older-root", "2026-07-01T00:00:00.000Z"),
    session("new-child", "2026-07-21T00:00:00.000Z", { parentSessionId: "older-root" }),
    session("middle-root", "2026-07-15T00:00:00.000Z"),
    session("child-a", "2026-07-10T00:00:00.000Z", { parentSessionId: "older-root" }),
  ];
  const tree = buildVisibleProjectSessionTree(sessions);
  assert.deepEqual(tree.map((node) => node.session.id), ["older-root", "middle-root"]);
  assert.deepEqual(tree[0].children.map((node) => node.session.id), ["new-child", "child-a"]);

  const cyclicTree = buildVisibleProjectSessionTree([
    session("a", undefined, { parentSessionId: "b" }),
    session("b", undefined, { parentSessionId: "a" }),
  ]);
  assert.deepEqual(cyclicTree.map((node) => node.session.id), ["a", "b"]);

  const tiedTree = buildVisibleProjectSessionTree([
    session("z", "2026-07-20T00:00:00.000Z"),
    session("a", "2026-07-20T00:00:00.000Z"),
  ]);
  assert.deepEqual(tiedTree.map((node) => node.session.id), ["a", "z"]);
});

test("Lineage includes the selected session's complete available family in depth-first subtree order", () => {
  const sessions = [
    session("root", "2026-07-01T00:00:00.000Z"),
    session("newer-own-child", "2026-07-20T00:00:00.000Z", { parentSessionId: "root" }),
    session("selected-branch", "2026-07-02T00:00:00.000Z", { parentSessionId: "root" }),
    session("newest-cousin", "2026-07-21T00:00:00.000Z", { parentSessionId: "selected-branch" }),
    session("selected", "2026-07-03T00:00:00.000Z", { parentSessionId: "selected-branch" }),
    session("unrelated", "2026-07-22T00:00:00.000Z"),
  ];
  const lineage = deriveSelectedSessionLineage(sessions, sessions, new Map(), "selected");
  assert.equal(lineage.status, "available");
  assert.equal(lineage.sessionCount, 5);
  assert.deepEqual(lineage.selectedAncestorSessionIds, ["root", "selected-branch"]);
  assert.deepEqual(
    flattenTreeIds(lineage.roots),
    ["root", "selected-branch", "newest-cousin", "selected", "newer-own-child"],
  );
});

test("Lineage treats missing parents and unavailable selections as bounded authority", () => {
  const sessions = [
    session("available-root", undefined, { parentSessionId: "missing" }),
    session("child", undefined, { parentSessionId: "available-root" }),
    session("other"),
  ];
  const lineage = deriveSelectedSessionLineage(sessions, sessions, new Map(), "available-root");
  assert.equal(lineage.status, "available");
  assert.deepEqual(flattenTreeIds(lineage.roots), ["available-root", "child"]);
  assert.deepEqual(lineage.selectedAncestorSessionIds, []);
  assert.deepEqual(deriveSelectedSessionLineage(sessions, sessions, new Map(), null), { status: "unavailable" });
  assert.deepEqual(deriveSelectedSessionLineage(sessions, sessions, new Map(), "not-listed"), { status: "unavailable" });
});

test("Lineage applies hidden closure after finding the raw selected family", () => {
  const sessions = [
    session("root"),
    session("selected", undefined, { parentSessionId: "root" }),
    session("hidden-sibling", undefined, { parentSessionId: "root" }),
    session("hidden-descendant", undefined, { parentSessionId: "hidden-sibling" }),
  ];
  const state = {
    ...createDefaultSidebarState(),
    explicitlyHiddenSessionIds: ["hidden-sibling"],
  };
  const normal = deriveSidebarSessionLists(sessions, state, false, Date.now());
  const visibleLineage = deriveSelectedSessionLineage(
    sessions,
    normal.presentedSessions,
    normal.hiddenSessionKinds,
    "selected",
  );
  assert.equal(visibleLineage.status, "available");
  assert.deepEqual(flattenTreeIds(visibleLineage.roots), ["root", "selected"]);
  assert.deepEqual(
    deriveSelectedSessionLineage(sessions, normal.presentedSessions, normal.hiddenSessionKinds, "hidden-sibling"),
    { status: "hidden", hiddenKind: "explicit" },
  );
  assert.deepEqual(
    deriveSelectedSessionLineage(sessions, normal.presentedSessions, normal.hiddenSessionKinds, "hidden-descendant"),
    { status: "hidden", hiddenKind: "inherited" },
  );

  const revealed = deriveSidebarSessionLists(sessions, state, true, Date.now());
  const revealedLineage = deriveSelectedSessionLineage(
    sessions,
    revealed.presentedSessions,
    revealed.hiddenSessionKinds,
    "selected",
  );
  assert.equal(revealedLineage.status, "available");
  assert.deepEqual(flattenTreeIds(revealedLineage.roots), [
    "root",
    "hidden-sibling",
    "hidden-descendant",
    "selected",
  ]);
});

test("Lineage terminates malformed cycles and retains their complete connected family", () => {
  const sessions = [
    session("a", undefined, { parentSessionId: "b" }),
    session("b", undefined, { parentSessionId: "a" }),
    session("tail", undefined, { parentSessionId: "a" }),
    session("branch", undefined, { parentSessionId: "b" }),
    session("unrelated"),
  ];
  const lineage = deriveSelectedSessionLineage(sessions, sessions, new Map(), "tail");
  assert.equal(lineage.status, "available");
  assert.equal(lineage.sessionCount, 4);
  assert.deepEqual(lineage.roots.map((node) => node.session.id), ["a", "b"]);
  assert.deepEqual(new Set(flattenTreeIds(lineage.roots)), new Set(["a", "b", "tail", "branch"]));
  assert.deepEqual(
    lineage.selectedAncestorSessionIds,
    ["a"],
    "reveal follows the rendered forest path and leaves the detached cycle root b unrelated",
  );
});

test("Lineage prefixes only rows whose project or worktree context differs from the selection", () => {
  const selected = session("selected");
  const sameContext = session("same");
  const otherWorktree = session("worktree", undefined, {
    cwd: "/repos/app-worktrees/feature",
    projectRoot: "/repos/app",
    worktreeBranch: "feature",
  });
  const otherProject = session("other-project", undefined, {
    cwd: "/repos/tools",
    projectRoot: "/repos/tools",
  });
  const prefixes = deriveShortestUniqueProjectPrefixes([selected, otherWorktree, otherProject]);

  assert.equal(getLineageSessionPrefix(sameContext, selected, prefixes), undefined);
  assert.equal(getLineageSessionPrefix(otherWorktree, selected, prefixes), "app · feature");
  assert.equal(getLineageSessionPrefix(otherProject, selected, prefixes), "tools");
});
