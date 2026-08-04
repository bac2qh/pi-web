import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  FILE_WATCH_CHANNEL, FILE_WATCH_CLOSE, parseFileWatchFrame, parseFileWatchFrameText,
} = await jiti.import("./file-watch-protocol.ts");

const connected = {
  protocol: "pi-web-file-watch", version: 1, serverInstanceId: "server",
  type: "connected", changeCount: 0, exists: true, size: 12,
};

test("defines the exact static channel and close policy", () => {
  assert.equal(FILE_WATCH_CHANNEL, "file-watch");
  assert.deepEqual(FILE_WATCH_CLOSE, { binary: 1003, policy: 1008, internal: 1011, owner: 1012, retry: 1013 });
});

test("accepts only strict path-free connected/change frames", () => {
  assert.deepEqual(parseFileWatchFrame(connected), connected);
  assert.deepEqual(parseFileWatchFrameText(JSON.stringify({ ...connected, type: "change", changeCount: 1, exists: false, size: 0 })), {
    ...connected, type: "change", changeCount: 1, exists: false, size: 0,
  });
  for (const invalid of [
    null, [], { ...connected, path: "/private" }, { ...connected, version: 2 },
    { ...connected, protocol: "wrong" }, { ...connected, serverInstanceId: "" },
    { ...connected, serverInstanceId: "x".repeat(129) }, { ...connected, type: "change", changeCount: 0 },
    { ...connected, changeCount: 1 }, { ...connected, size: -1 },
    { ...connected, size: Number.MAX_SAFE_INTEGER + 1 }, { ...connected, exists: false, size: 1 },
  ]) assert.equal(parseFileWatchFrame(invalid), null);
});

test("wire frames contain no path, name, content, ticket, session, time, or raw event field", () => {
  const text = JSON.stringify(connected);
  for (const forbidden of ["path", "basename", "content", "ticket", "sessionId", "mtime", "timestamp", "eventType", "address", "error"]) {
    assert.equal(text.includes(forbidden), false);
  }
});
