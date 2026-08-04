import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { authorizeFileRequest, normalizeAbsoluteFilePath } = await jiti.import("./file-authorization.ts");
const { isFilePathAllowed } = await jiti.import("./file-access.ts");

function dependencies({ roots = new Set(), referenced = false } = {}) {
  const calls = [];
  return {
    calls,
    value: {
      async getAllowedRoots() { calls.push("roots"); return roots; },
      isAllowed(filePath, allowedRoots) { calls.push("allowed"); return isFilePathAllowed(filePath, allowedRoots); },
      async isReferenced(filePath, sessionId) { calls.push(["reference", filePath, sessionId]); return referenced; },
    },
  };
}

test("shared decision prefers lexical roots and only permits exact-reference fallback when requested", async () => {
  const root = path.resolve("/synthetic/root");
  const inside = path.join(root, "control\u0001name.txt");
  const allowed = dependencies({ roots: new Set([root]), referenced: true });
  assert.equal(await authorizeFileRequest(inside, "session", true, allowed.value), "allowed_root");
  assert.deepEqual(allowed.calls, ["roots", "allowed"]);

  const referenced = dependencies({ referenced: true });
  assert.equal(await authorizeFileRequest("/outside/exact", "session", true, referenced.value), "allowed_session_reference");
  assert.equal(await authorizeFileRequest("/outside/exact", "session", false, dependencies({ referenced: true }).value), "denied");
});

test("lexical authorization preserves sibling-prefix and Windows case/separator behavior", () => {
  assert.equal(isFilePathAllowed("/rooted/file", new Set(["/root"])), false);
  assert.equal(isFilePathAllowed("C:/Users/Test/File.txt", new Set(["c:\\users\\test"])), true);
  assert.equal(isFilePathAllowed("C:/Users/Tester/File.txt", new Set(["c:\\users\\test"])), false);
  assert.equal(isFilePathAllowed("//SERVER/Share/Mixed.txt", new Set(["\\\\server\\share"])), true);
  assert.equal(normalizeAbsoluteFilePath("C:\\Users\\Test\\..\\File.txt"), "C:/Users/File.txt");
  assert.equal(normalizeAbsoluteFilePath("\\\\Server\\Share\\Mixed.txt"), "//Server/Share/Mixed.txt");
  assert.equal(normalizeAbsoluteFilePath("relative/file"), null);
});

test("shared decision fails closed for denied and unavailable references without widening list access", async () => {
  for (const referenced of [false, true]) {
    const denied = dependencies({ referenced });
    assert.equal(await authorizeFileRequest("/outside/file", null, false, denied.value), "denied");
    assert.deepEqual(denied.calls, ["roots", "allowed"]);
  }

  const stale = dependencies({ referenced: false });
  assert.equal(await authorizeFileRequest("/outside/file", "stale-session", true, stale.value), "denied");
  assert.deepEqual(stale.calls, ["roots", "allowed", ["reference", "/outside/file", "stale-session"]]);
});
