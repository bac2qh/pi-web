import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

test("page mounts exactly one global status provider above the app shell", async () => {
  const [pageSource, providerSource] = await Promise.all([
    source("../app/page.tsx"),
    source("./GlobalStatusProvider.tsx"),
  ]);
  assert.equal((pageSource.match(/<GlobalStatusProvider>/g) ?? []).length, 1);
  assert.ok(pageSource.indexOf("<GlobalStatusProvider>") < pageSource.indexOf("<AppShell />"));
  assert.ok(pageSource.indexOf("<AppShell />") < pageSource.indexOf("</GlobalStatusProvider>"));
  assert.match(providerSource, /useRef<GlobalStatusController \| null>/);
  assert.match(providerSource, /controller\.subscribe\(setSnapshot\)/);
  assert.match(providerSource, /getCurrentSnapshot = useCallback\(\(\) => controller\.getSnapshot\(\)/);
  assert.match(providerSource, /controller\.start\(\)/);
  assert.match(providerSource, /unsubscribe\(\);\s*controller\.stop\(\)/);
});

test("provider preserves discovery deliveries as subscriptions rather than scalar generation state", async () => {
  const providerSource = await source("./GlobalStatusProvider.tsx");
  assert.match(providerSource, /subscribeSessionsChanged/);
  assert.match(providerSource, /controller\.subscribeSessionsChanged\(listener\)/);
  assert.doesNotMatch(providerSource, /useState<.*sessionListGeneration/);
});

test("sidebar consumes provider authority and owns no ticket, socket, or global EventSource", async () => {
  const sidebarSource = await source("./SessionSidebar.tsx");
  assert.match(sidebarSource, /useGlobalStatus\(\)/);
  assert.match(sidebarSource, /getCurrentSnapshot: getCurrentGlobalStatusSnapshot/);
  assert.match(sidebarSource, /shouldApplySidebarHttpRunningFallback\(getCurrentGlobalStatusSnapshot\)/);
  assert.match(sidebarSource, /subscribeSessionsChanged/);
  assert.doesNotMatch(sidebarSource, /new WebSocket|transport\/ticket|new EventSource/);
});

test("migration removes only global SSE and preserves later persistent streams plus OAuth", async () => {
  await assert.rejects(
    access(new URL("../app/api/agent/running/events/route.ts", import.meta.url)),
  );
  const [sessionRoute, sessionHook, fileViewer, modelsConfig] = await Promise.all([
    source("../app/api/agent/[id]/events/route.ts"),
    source("../hooks/useAgentSession.ts"),
    source("./FileViewer.tsx"),
    source("./ModelsConfig.tsx"),
  ]);
  assert.match(sessionRoute, /text\/event-stream/);
  assert.match(sessionHook, /new EventSource\(`\/api\/agent\/\$\{encodeURIComponent\(sid\)\}\/events`\)/);
  assert.equal((fileViewer.match(/new EventSource\(/g) ?? []).length, 4);
  assert.equal((modelsConfig.match(/new EventSource\(/g) ?? []).length, 1);
});
