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
