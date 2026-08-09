import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  getSessionListRefreshGeneration,
  notifySessionListRefresh,
  subscribeSessionListRefresh,
} = await jiti.import("./session-list-refresh.ts");

test("the lightweight HMR-stable notifier invalidates discovery and publishes one replay generation", () => {
  const previous = {
    refreshGeneration: globalThis.__piSessionListRefreshGeneration,
    refreshListeners: globalThis.__piSessionListRefreshListeners,
    listGeneration: globalThis.__piSessionListGeneration,
    listCache: globalThis.__piSessionListCache,
  };
  try {
    globalThis.__piSessionListRefreshGeneration = 4;
    globalThis.__piSessionListRefreshListeners = new Set();
    globalThis.__piSessionListGeneration = 10;
    globalThis.__piSessionListCache = { data: [], ts: Date.now() };
    const delivered = [];
    const unsubscribe = subscribeSessionListRefresh((generation) => delivered.push(generation));
    subscribeSessionListRefresh(() => { throw new Error("isolated listener"); });

    notifySessionListRefresh();
    assert.equal(getSessionListRefreshGeneration(), 5);
    assert.deepEqual(delivered, [5]);
    assert.equal(globalThis.__piSessionListGeneration, 11);
    assert.equal(globalThis.__piSessionListCache, undefined);

    unsubscribe();
    notifySessionListRefresh();
    assert.deepEqual(delivered, [5]);
    assert.equal(getSessionListRefreshGeneration(), 6);
  } finally {
    globalThis.__piSessionListRefreshGeneration = previous.refreshGeneration;
    globalThis.__piSessionListRefreshListeners = previous.refreshListeners;
    globalThis.__piSessionListGeneration = previous.listGeneration;
    globalThis.__piSessionListCache = previous.listCache;
  }
});

test("HTTP and live rename paths notify browsers without starting an AgentSession", async () => {
  const [route, rpc, channel, seam] = await Promise.all([
    readFile(new URL("../app/api/sessions/[id]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8"),
    readFile(new URL("./global-status-channel.ts", import.meta.url), "utf8"),
    readFile(new URL("./session-list-refresh.ts", import.meta.url), "utf8"),
  ]);
  assert.match(route, /appendSessionInfo\(name\.trim\(\)\);\s*notifySessionListRefresh\(\)/u);
  assert.match(rpc, /case "set_session_name"[\s\S]*notifySessionListRefresh\(\)/u);
  assert.match(channel, /from "\.\/session-list-refresh"/u);
  assert.match(seam, /invalidateSessionListCache\(\)/u);
  assert.doesNotMatch(seam, /AgentSession|startRpcSession|SessionManager/u);
});
