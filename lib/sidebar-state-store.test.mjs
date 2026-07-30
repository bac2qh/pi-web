import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  SIDEBAR_STATE_FILENAME,
  readSidebarState,
  reconcileStoredSidebarState,
  updateSidebarState,
} = await jiti.import("./sidebar-state-store.ts");

function session(id, overrides = {}) {
  return {
    path: `/sessions/${id}.jsonl`,
    id,
    cwd: "/repos/app",
    created: "2026-07-21T12:00:00.000Z",
    modified: "2026-07-21T12:00:00.000Z",
    messageCount: 2,
    firstMessage: `Session ${id}`,
    projectRoot: "/repos/app",
    ...overrides,
  };
}

async function withStore(t, run) {
  const agentDir = await mkdtemp(join(tmpdir(), "pi-web-sidebar-state-"));
  t.after(() => rm(agentDir, { recursive: true, force: true }));
  return run(agentDir);
}

async function withCapturedErrors(run) {
  const original = console.error;
  const calls = [];
  console.error = (...args) => { calls.push(args); };
  try {
    const value = await run();
    return { value, calls };
  } finally {
    console.error = original;
  }
}

async function withMutedErrors(run) {
  return (await withCapturedErrors(run)).value;
}

test("missing storage reads defaults without creating a file", (t) => withStore(t, async (agentDir) => {
  const state = await readSidebarState({ agentDir });
  assert.deepEqual(state, {
    version: 1,
    revision: 0,
    pinnedSessionIds: [],
    explicitlyHiddenSessionIds: [],
  });
  assert.deepEqual(await readdir(agentDir), []);
}));

test("operations write atomically and idempotent operations do not advance revision", (t) => withStore(t, async (agentDir) => {
  const sessions = [session("one"), session("two")];
  const first = await updateSidebarState({ operation: "pin", sessionId: "one" }, sessions, { agentDir });
  assert.equal(first.revision, 1);
  const repeated = await updateSidebarState({ operation: "pin", sessionId: "one" }, sessions, { agentDir });
  assert.equal(repeated.revision, 1);
  assert.deepEqual(repeated.pinnedSessionIds, ["one"]);

  const stored = JSON.parse(await readFile(join(agentDir, SIDEBAR_STATE_FILENAME), "utf8"));
  assert.deepEqual(stored, repeated);
  assert.deepEqual((await readdir(agentDir)).filter((name) => name.includes(".tmp-")), []);
  assert.equal((await readdir(agentDir)).some((name) => name.endsWith(".lock")), false);
}));

test("the exclusive lock preserves concurrent operations", (t) => withStore(t, async (agentDir) => {
  const sessions = [session("one"), session("two")];
  await Promise.all([
    updateSidebarState({ operation: "pin", sessionId: "one" }, sessions, { agentDir, lockRetryMs: 2 }),
    updateSidebarState({ operation: "pin", sessionId: "two" }, sessions, { agentDir, lockRetryMs: 2 }),
  ]);
  const stored = await readSidebarState({ agentDir });
  assert.deepEqual(new Set(stored.pinnedSessionIds), new Set(["one", "two"]));
  assert.equal(stored.revision, 2);
}));

test("malformed and unsupported state is refused without overwriting the file", (t) => withStore(t, async (agentDir) => {
  const statePath = join(agentDir, SIDEBAR_STATE_FILENAME);
  const malformed = "{ definitely not json\n";
  await writeFile(statePath, malformed);

  await withMutedErrors(async () => {
    await assert.rejects(
      updateSidebarState({ operation: "pin", sessionId: "one" }, [session("one")], { agentDir }),
      (error) => error?.code === "sidebar_state_invalid",
    );
  });
  assert.equal(await readFile(statePath, "utf8"), malformed);

  const unsupported = `${JSON.stringify({ version: 2, revision: 0, pinnedSessionIds: [], explicitlyHiddenSessionIds: [] })}\n`;
  await writeFile(statePath, unsupported);
  await withMutedErrors(async () => {
    await assert.rejects(
      reconcileStoredSidebarState([session("one")], { agentDir }),
      (error) => error?.code === "sidebar_state_invalid",
    );
  });
  assert.equal(await readFile(statePath, "utf8"), unsupported);
}));

test("lock acquisition times out without mutating state", (t) => withStore(t, async (agentDir) => {
  const lockPath = join(agentDir, `${SIDEBAR_STATE_FILENAME}.lock`);
  await writeFile(lockPath, "held\n");
  await withMutedErrors(async () => {
    await assert.rejects(
      updateSidebarState(
        { operation: "pin", sessionId: "one" },
        [session("one")],
        { agentDir, lockTimeoutMs: 20, lockRetryMs: 2 },
      ),
      (error) => error?.code === "sidebar_state_lock_timeout",
    );
  });
  assert.deepEqual(await readdir(agentDir), [`${SIDEBAR_STATE_FILENAME}.lock`]);
}));

test("stale ids are pruned only when explicit successful-listing reconciliation runs", (t) => withStore(t, async (agentDir) => {
  const statePath = join(agentDir, SIDEBAR_STATE_FILENAME);
  await writeFile(statePath, `${JSON.stringify({
    version: 1,
    revision: 7,
    pinnedSessionIds: ["kept", "stale"],
    explicitlyHiddenSessionIds: ["kept", "stale"],
  })}\n`);

  const before = await readSidebarState({ agentDir });
  assert.deepEqual(before.pinnedSessionIds, ["kept", "stale"]);
  const reconciled = await reconcileStoredSidebarState([session("kept")], { agentDir });
  assert.equal(reconciled.revision, 8);
  assert.deepEqual(reconciled.pinnedSessionIds, ["kept"]);
  assert.deepEqual(reconciled.explicitlyHiddenSessionIds, ["kept"]);
}));

test("read and directory-preparation failures map to stable sanitized categories", (t) => withStore(t, async (agentDir) => {
  const statePath = join(agentDir, SIDEBAR_STATE_FILENAME);
  await writeFile(statePath, `${JSON.stringify({
    version: 1,
    revision: 0,
    pinnedSessionIds: [],
    explicitlyHiddenSessionIds: [],
  })}\n`);

  if (typeof process.getuid !== "function" || process.getuid() !== 0) {
    await chmod(statePath, 0);
    try {
      await withMutedErrors(async () => {
        await assert.rejects(
          readSidebarState({ agentDir }),
          (error) => error?.code === "sidebar_state_read_failed" && !error.message.includes(agentDir),
        );
      });
    } finally {
      await chmod(statePath, 0o600);
    }
  }

  const notDirectory = join(agentDir, "not-a-directory");
  await writeFile(notDirectory, "file\n");
  await withMutedErrors(async () => {
    await assert.rejects(
      updateSidebarState({ operation: "pin", sessionId: "one" }, [session("one")], { agentDir: notDirectory }),
      (error) => error?.code === "sidebar_state_write_failed" && !error.message.includes(notDirectory),
    );
  });
}));

test("diagnostics expose only bounded categories, counts, and sanitized error classes", (t) => withStore(t, async (agentDir) => {
  const privateSessionId = "private-session-id-sentinel";
  const privatePayload = "private-message-payload-sentinel";
  const invalidDir = join(agentDir, "invalid-fixture");
  const invalidStatePath = join(invalidDir, SIDEBAR_STATE_FILENAME);
  const lockDir = join(agentDir, "lock-fixture");
  const readDir = join(agentDir, "read-fixture");
  const writePath = join(agentDir, "write-fixture-file");
  await Promise.all([mkdir(invalidDir), mkdir(lockDir), mkdir(readDir)]);
  await writeFile(invalidStatePath, `{ ${privatePayload}\n`);
  await writeFile(join(lockDir, `${SIDEBAR_STATE_FILENAME}.lock`), "held\n");
  await writeFile(join(readDir, SIDEBAR_STATE_FILENAME), `${JSON.stringify({
    version: 1,
    revision: 0,
    pinnedSessionIds: [],
    explicitlyHiddenSessionIds: [],
  })}\n`);
  await writeFile(writePath, "not a directory\n");

  const { calls } = await withCapturedErrors(async () => {
    await assert.rejects(
      updateSidebarState({ operation: "pin", sessionId: privateSessionId }, [session(privateSessionId)], { agentDir: invalidDir }),
    );
    await assert.rejects(
      updateSidebarState(
        { operation: "pin", sessionId: privateSessionId },
        [session(privateSessionId)],
        { agentDir: lockDir, lockTimeoutMs: 10, lockRetryMs: 2 },
      ),
    );
    if (typeof process.getuid !== "function" || process.getuid() !== 0) {
      const unreadablePath = join(readDir, SIDEBAR_STATE_FILENAME);
      await chmod(unreadablePath, 0);
      try {
        await assert.rejects(readSidebarState({ agentDir: readDir }));
      } finally {
        await chmod(unreadablePath, 0o600);
      }
    }
    await assert.rejects(
      updateSidebarState({ operation: "pin", sessionId: privateSessionId }, [session(privateSessionId)], { agentDir: writePath }),
    );
  });

  const categories = new Set(calls.map(([category]) => category));
  assert.equal(categories.has("[pi-web] sidebar_state_invalid"), true);
  assert.equal(categories.has("[pi-web] sidebar_state_lock_timeout"), true);
  assert.equal(categories.has("[pi-web] sidebar_state_write_failed"), true);
  if (typeof process.getuid !== "function" || process.getuid() !== 0) {
    assert.equal(categories.has("[pi-web] sidebar_state_read_failed"), true);
  }
  for (const [category, details] of calls) {
    assert.match(category, /^\[pi-web\] sidebar_state_(invalid|lock_timeout|read_failed|write_failed)$/);
    assert.deepEqual(
      Object.keys(details).sort(),
      ["errorClass", "hiddenCount", "operation", "pinnedCount", "revision"],
    );
    assert.match(details.errorClass, /^[A-Za-z_$][A-Za-z0-9_$.-]{0,79}$/);
    const serialized = JSON.stringify([category, details]);
    assert.equal(serialized.includes(privateSessionId), false);
    assert.equal(serialized.includes(privatePayload), false);
    assert.equal(serialized.includes(agentDir), false);
  }
}));

test("an invalidated session snapshot cannot reconcile or overwrite newer state", (t) => withStore(t, async (agentDir) => {
  const originalGeneration = globalThis.__piSessionListGeneration;
  const statePath = join(agentDir, SIDEBAR_STATE_FILENAME);
  const originalState = `${JSON.stringify({
    version: 1,
    revision: 3,
    pinnedSessionIds: ["new-session"],
    explicitlyHiddenSessionIds: [],
  })}\n`;
  await writeFile(statePath, originalState);

  try {
    globalThis.__piSessionListGeneration = 12;
    await assert.rejects(
      reconcileStoredSidebarState([session("old-session")], {
        agentDir,
        expectedSessionListGeneration: 11,
      }),
      (error) => error?.name === "SidebarStateListingChangedError",
    );
    assert.equal(await readFile(statePath, "utf8"), originalState);
    assert.equal((await readdir(agentDir)).some((name) => name.endsWith(".lock")), false);
  } finally {
    globalThis.__piSessionListGeneration = originalGeneration;
  }
}));

test("writes refuse a state that would exceed the read byte limit", (t) => withStore(t, async (agentDir) => {
  const statePath = join(agentDir, SIDEBAR_STATE_FILENAME);
  const limit = 1024 * 1024;
  const ids = [];
  let nextId = "";
  for (let index = 0; index < 10_000; index += 1) {
    const candidate = `session-${String(index).padStart(5, "0")}-${"x".repeat(480)}`;
    const candidateState = {
      version: 1,
      revision: 0,
      pinnedSessionIds: [...ids, candidate],
      explicitlyHiddenSessionIds: [],
    };
    if (Buffer.byteLength(`${JSON.stringify(candidateState, null, 2)}\n`) > limit) {
      nextId = candidate;
      break;
    }
    ids.push(candidate);
  }
  assert.ok(nextId && ids.length > 0);
  const storedContents = `${JSON.stringify({
    version: 1,
    revision: 0,
    pinnedSessionIds: ids,
    explicitlyHiddenSessionIds: [],
  }, null, 2)}\n`;
  await writeFile(statePath, storedContents);

  await withMutedErrors(async () => {
    await assert.rejects(
      updateSidebarState(
        { operation: "pin", sessionId: nextId },
        [...ids, nextId].map((id) => session(id)),
        { agentDir },
      ),
      (error) => error?.code === "sidebar_state_write_failed",
    );
  });
  assert.equal(await readFile(statePath, "utf8"), storedContents);
  assert.deepEqual((await readdir(agentDir)).filter((name) => name.includes(".tmp-")), []);
}));

test("hiding an ancestor atomically removes redundant descendant markers", (t) => withStore(t, async (agentDir) => {
  const sessions = [session("root"), session("child", { parentSessionId: "root" })];
  await updateSidebarState({ operation: "hide", sessionId: "child" }, sessions, { agentDir });
  const state = await updateSidebarState({ operation: "hide", sessionId: "root" }, sessions, { agentDir });
  assert.deepEqual(state.explicitlyHiddenSessionIds, ["root"]);
  assert.equal(state.revision, 2);
}));
