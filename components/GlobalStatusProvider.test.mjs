import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
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

test("agent and file persistent SSE callers are absent while short-lived OAuth remains", async () => {
  await Promise.all([
    assert.rejects(access(new URL("../app/api/agent/running/events/route.ts", import.meta.url))),
    assert.rejects(access(new URL("../app/api/agent/[id]/events/route.ts", import.meta.url))),
  ]);
  const [sessionHook, fileViewer, modelsConfig] = await Promise.all([
    source("../hooks/useAgentSession.ts"),
    source("./FileViewer.tsx"),
    source("./ModelsConfig.tsx"),
  ]);
  assert.doesNotMatch(sessionHook, /EventSource|\/api\/agent\/[^\n]*\/events/);
  assert.doesNotMatch(fileViewer, /EventSource|type:\s*["']watch["']|[?&]type=watch/);
  assert.match(fileViewer, /useFileWatch/);
  assert.equal((modelsConfig.match(/new EventSource\(/g) ?? []).length, 1);

  const repositoryRoot = path.resolve(new URL("..", import.meta.url).pathname);
  const productionFiles = [];
  async function collect(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await collect(absolute);
      else if (/\.(?:[cm]?[jt]sx?)$/.test(entry.name) && !/\.test\.[cm]?[jt]sx?$/.test(entry.name)) productionFiles.push(absolute);
    }
  }
  for (const directory of ["app", "components", "hooks", "lib"]) await collect(path.join(repositoryRoot, directory));
  const eventSourceCallers = [];
  for (const file of productionFiles) {
    const contents = await readFile(file, "utf8");
    const count = (contents.match(/new\s+EventSource\s*\(/g) ?? []).length;
    for (let index = 0; index < count; index += 1) eventSourceCallers.push(path.relative(repositoryRoot, file));
  }
  assert.deepEqual(eventSourceCallers, ["components/ModelsConfig.tsx"]);
});
