import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  UNREAD_SESSION_IDS_STORAGE_KEY,
  getBackgroundCompletedSessionIds,
  loadUnreadSessionIds,
  pruneUnreadSessionIds,
  saveUnreadSessionIds,
  setSessionUnread,
  updateUnreadSessionIdsForRunningState,
} = await jiti.import("./sidebar-unread-state.ts");

function memoryStorage(initialValue = null) {
  const values = new Map();
  if (initialValue !== null) values.set(UNREAD_SESSION_IDS_STORAGE_KEY, initialValue);
  return {
    values,
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

test("unread storage restores string IDs and tolerates absent, malformed, or unavailable storage", () => {
  assert.deepEqual([...loadUnreadSessionIds(null)], []);
  assert.deepEqual([...loadUnreadSessionIds(memoryStorage("not json"))], []);
  assert.deepEqual([...loadUnreadSessionIds(memoryStorage(JSON.stringify({ ids: ["one"] })))], []);
  assert.deepEqual(
    [...loadUnreadSessionIds(memoryStorage(JSON.stringify(["one", 4, "one", null, "two"])))],
    ["one", "two"],
  );

  const unavailable = {
    getItem() { throw new Error("blocked"); },
    setItem() { throw new Error("blocked"); },
    removeItem() { throw new Error("blocked"); },
  };
  assert.doesNotThrow(() => loadUnreadSessionIds(unavailable));
  assert.deepEqual([...loadUnreadSessionIds(unavailable)], []);
  assert.doesNotThrow(() => saveUnreadSessionIds(new Set(["one"]), unavailable));
});

test("unread storage round-trips IDs and removes the key for an empty set", () => {
  const storage = memoryStorage();
  saveUnreadSessionIds(new Set(["one", "two"]), storage);
  assert.equal(storage.values.get(UNREAD_SESSION_IDS_STORAGE_KEY), JSON.stringify(["one", "two"]));
  assert.deepEqual([...loadUnreadSessionIds(storage)], ["one", "two"]);

  saveUnreadSessionIds(new Set(), storage);
  assert.equal(storage.values.has(UNREAD_SESSION_IDS_STORAGE_KEY), false);
});

test("manual unread updates are immutable, idempotent, and explicit opening clears a selected row", () => {
  const original = new Set(["other"]);
  const marked = setSessionUnread(original, "selected", true);
  assert.notEqual(marked, original);
  assert.deepEqual([...original], ["other"]);
  assert.deepEqual([...marked], ["other", "selected"]);
  assert.equal(setSessionUnread(marked, "selected", true), marked);

  const opened = setSessionUnread(marked, "selected", false);
  assert.deepEqual([...opened], ["other"]);
  assert.equal(setSessionUnread(opened, "selected", false), opened);
});

test("running state clears unread before unselected background completions become unread", () => {
  const previousRunning = new Set(["background-complete", "selected-complete", "still-running"]);
  const running = new Set(["still-running", "newly-running"]);
  const completedInBackground = getBackgroundCompletedSessionIds(
    previousRunning,
    running,
    "selected-complete",
  );
  assert.deepEqual(completedInBackground, ["background-complete"]);

  const updated = updateUnreadSessionIdsForRunningState(
    new Set(["manual", "still-running", "newly-running"]),
    running,
    completedInBackground,
  );
  assert.deepEqual([...updated], ["manual", "background-complete"]);
  assert.equal(updated.has("selected-complete"), false);
});

test("manual unread survives reload, a new run clears it, and later background completion restores it", () => {
  const storage = memoryStorage();
  const manuallyMarked = setSessionUnread(new Set(), "session", true);
  saveUnreadSessionIds(manuallyMarked, storage);
  const reloaded = loadUnreadSessionIds(storage);
  assert.equal(reloaded.has("session"), true);

  const running = updateUnreadSessionIdsForRunningState(reloaded, new Set(["session"]), []);
  assert.equal(running.has("session"), false);

  const completed = getBackgroundCompletedSessionIds(new Set(["session"]), new Set(), "different");
  const unreadAgain = updateUnreadSessionIdsForRunningState(running, new Set(), completed);
  assert.equal(unreadAgain.has("session"), true);

  const explicitlyOpened = setSessionUnread(unreadAgain, "session", false);
  saveUnreadSessionIds(explicitlyOpened, storage);
  assert.equal(storage.values.has(UNREAD_SESSION_IDS_STORAGE_KEY), false);
});

test("complete-list pruning removes stale unread IDs without changing an already valid set", () => {
  const unread = new Set(["kept", "stale"]);
  const pruned = pruneUnreadSessionIds(unread, new Set(["kept", "other"]));
  assert.deepEqual([...pruned], ["kept"]);
  assert.deepEqual([...unread], ["kept", "stale"]);
  assert.equal(pruneUnreadSessionIds(pruned, new Set(["kept"])), pruned);
});
