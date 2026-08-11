import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import { SessionManager } from "@earendil-works/pi-coding-agent";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const sessionRoute = await jiti.import("../app/api/sessions/[id]/route.ts");
const contextRoute = await jiti.import("../app/api/sessions/[id]/context/route.ts");
const exportRoute = await jiti.import("../app/api/sessions/[id]/export/route.ts");
const { createSideSessionBranch } = await jiti.import("./session-clone.ts");
const { cacheSessionPath, invalidateSessionPathCache } = await jiti.import("./session-reader.ts");
const sessionRouteSource = await readFile(
  new URL("../app/api/sessions/[id]/route.ts", import.meta.url),
  "utf8",
);

test("sessions/[id] exposes only GET and PATCH", () => {
  const exportNames = Object.getOwnPropertyNames(sessionRoute)
    .filter((name) => name !== "__esModule")
    .sort();

  assert.deepEqual(exportNames, ["GET", "PATCH"]);
  assert.equal(typeof sessionRoute.GET, "function");
  assert.equal(typeof sessionRoute.PATCH, "function");
});

test("side root/context hide inherited history and refuse pre-boundary leaves", async (t) => {
  const sessionDir = mkdtempSync(join(tmpdir(), "pi-web-side-route-"));
  t.after(() => rmSync(sessionDir, { recursive: true, force: true }));
  const source = SessionManager.create(join(sessionDir, "cwd"), sessionDir);
  const sourceUser = source.appendMessage({ role: "user", content: "inherited request", timestamp: Date.now() });
  const sourceAssistant = source.appendMessage({
    role: "assistant", provider: "test", model: "test", timestamp: Date.now(),
    content: [{ type: "text", text: "inherited answer" }],
  });
  const created = createSideSessionBranch({
    sourceSessionFile: source.getSessionFile(),
    sourceSessionDir: sessionDir,
    sourceSessionId: source.getSessionId(),
    cutoffId: sourceAssistant,
    name: "side-conversation-2026-08-11T12-34-56-789Z",
  });
  assert.equal(created.status, "created");
  const side = SessionManager.open(created.newSessionFile, sessionDir);
  const sideUser = side.appendMessage({ role: "user", content: "side request", timestamp: Date.now() });
  const sideAssistant = side.appendMessage({
    role: "assistant", provider: "test", model: "test", timestamp: Date.now(),
    content: [{ type: "text", text: "side answer" }],
  });
  cacheSessionPath(source.getSessionId(), source.getSessionFile());
  cacheSessionPath(created.newSessionId, created.newSessionFile);
  t.after(() => {
    invalidateSessionPathCache(source.getSessionId());
    invalidateSessionPathCache(created.newSessionId);
  });

  const rootResponse = await sessionRoute.GET(
    new Request(`http://localhost/api/sessions/${created.newSessionId}`),
    { params: Promise.resolve({ id: created.newSessionId }) },
  );
  assert.equal(rootResponse.status, 200);
  const root = await rootResponse.json();
  assert.deepEqual(root.context.entryIds, [sideUser, sideAssistant]);
  assert.equal(JSON.stringify(root.context).includes("inherited request"), false);
  assert.equal(JSON.stringify(root.context).includes("inherited answer"), false);
  assert.equal(root.sideSession.markerEntryId, created.markerEntryId);
  assert.equal(root.sideSession.parentSessionId, source.getSessionId());
  assert.equal(JSON.stringify(root.tree).includes(sourceUser), false);
  assert.equal(JSON.stringify(root.tree).includes(sourceAssistant), false);
  assert.equal(JSON.stringify(root.tree).includes(created.markerEntryId), false);

  const allowed = await contextRoute.GET(
    new Request(`http://localhost/api/sessions/${created.newSessionId}/context?leafId=${sideUser}`),
    { params: Promise.resolve({ id: created.newSessionId }) },
  );
  assert.equal(allowed.status, 200);
  assert.deepEqual((await allowed.json()).context.entryIds, [sideUser]);

  const refused = await contextRoute.GET(
    new Request(`http://localhost/api/sessions/${created.newSessionId}/context?leafId=${sourceAssistant}`),
    { params: Promise.resolve({ id: created.newSessionId }) },
  );
  assert.equal(refused.status, 409);
  assert.match((await refused.json()).error, /marker_off_branch/);

  const boundaryRefused = await contextRoute.GET(
    new Request(`http://localhost/api/sessions/${created.newSessionId}/context?leafId=${created.markerEntryId}`),
    { params: Promise.resolve({ id: created.newSessionId }) },
  );
  assert.equal(boundaryRefused.status, 409);
  assert.match((await boundaryRefused.json()).error, /side_boundary/);

  const exportResponse = await exportRoute.GET(
    new Request(`http://localhost/api/sessions/${created.newSessionId}/export?inline=1`),
    { params: Promise.resolve({ id: created.newSessionId }) },
  );
  assert.equal(exportResponse.status, 200);
  const exportedHtml = await exportResponse.text();
  const encodedExport = exportedHtml.match(/<script id="session-data" type="application\/json">([^<]+)<\/script>/)?.[1];
  assert.ok(encodedExport, "full-history export omitted its native session payload");
  const exportedSession = JSON.parse(Buffer.from(encodedExport, "base64").toString("utf8"));
  assert.deepEqual(exportedSession.entries.map((entry) => entry.id), [
    sourceUser,
    sourceAssistant,
    created.markerEntryId,
    exportedSession.entries[3].id,
    sideUser,
    sideAssistant,
  ]);
  assert.equal(exportedSession.entries[0].message.content, "inherited request");
  assert.equal(exportedSession.entries[1].message.content[0].text, "inherited answer");
  assert.equal(exportedSession.entries[2].type, "custom_message");
  assert.equal(exportedSession.entries[3].type, "session_info");
  assert.equal(exportedSession.entries[3].name, created.name);
  assert.equal(exportedSession.entries[4].message.content, "side request");
  assert.equal(exportedSession.entries[5].message.content[0].text, "side answer");
});

test("sessions/[id] contains no permanent-deletion dependencies or logic", () => {
  assert.doesNotMatch(sessionRouteSource, /\bDELETE\b/);
  assert.doesNotMatch(
    sessionRouteSource,
    /\b(?:getRpcSession|invalidateSessionPathCache|readSessionHeader|readdirSync|readFileSync|unlinkSync|writeFileSync)\b/,
  );
  assert.doesNotMatch(sessionRouteSource, /from ["']path["']/);
});
