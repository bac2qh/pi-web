import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { isExactCloneCommand } = await jiti.import("../hooks/useAgentSession.ts");
const {
  canSubmitStreamingComposer,
  isSubmittedComposerStateUnchanged,
} = await jiti.import("./ChatInput.tsx");

test("recognizes only the exact trimmed clone command", () => {
  assert.equal(isExactCloneCommand("/clone"), true);
  assert.equal(isExactCloneCommand("  /clone  "), true);
  assert.equal(isExactCloneCommand("/clone later"), false);
  assert.equal(isExactCloneCommand("/clone-now"), false);
  assert.equal(isExactCloneCommand("/Clone"), false);
});

test("routes clone through the built-in host before image and delivery guards", async () => {
  const source = await readFile(new URL("./ChatInput.tsx", import.meta.url), "utf8");
  assert.match(source, /name: "clone", description: "Duplicate the current active branch"/);

  const idleSource = source.slice(
    source.indexOf("const handleSend"),
    source.indexOf("const slashQuery"),
  );
  const idleCloneIndex = idleSource.indexOf("isExactCloneCommand(msg)");
  assert.ok(idleCloneIndex >= 0);
  assert.ok(idleSource.indexOf("if (!attachedImages.length && msg.startsWith", idleCloneIndex) > idleCloneIndex);
  assert.ok(idleSource.indexOf("onSend(msg", idleCloneIndex) > idleCloneIndex);

  const queuedSource = source.slice(
    source.indexOf("const sendQueued"),
    source.indexOf("const getNextSlashIndex"),
  );
  const queuedCloneIndex = queuedSource.indexOf("isExactCloneCommand(msg)");
  assert.ok(queuedCloneIndex >= 0);
  for (const laterGuardOrDelivery of [
    "if (attachedImages.length) return",
    "onPromptWithStreamingBehavior(msg",
    "onSteer(msg",
    "onFollowUp(msg",
  ]) {
    assert.ok(
      queuedSource.indexOf(laterGuardOrDelivery, queuedCloneIndex) > queuedCloneIndex,
      `${laterGuardOrDelivery} must follow the clone host guard`,
    );
  }
  assert.match(queuedSource, /isSubmittedComposerStateUnchanged\(/);
});

test("allows exact clone through streaming controls even with attached images", () => {
  assert.equal(canSubmitStreamingComposer("normal message", 0), true);
  assert.equal(canSubmitStreamingComposer("normal message", 1), false);
  assert.equal(canSubmitStreamingComposer("  /clone  ", 1), true);
  assert.equal(canSubmitStreamingComposer("/clone later", 1), false);
  assert.equal(canSubmitStreamingComposer("", 0), false);
});

test("clears only the unchanged submitted composer state", () => {
  const submittedImages = [{ data: "image", mimeType: "image/png", previewUrl: "blob:test" }];

  assert.equal(isSubmittedComposerStateUnchanged("/clone", submittedImages, "/clone", submittedImages), true);
  assert.equal(isSubmittedComposerStateUnchanged("new draft", submittedImages, "/clone", submittedImages), false);
  assert.equal(isSubmittedComposerStateUnchanged("/clone", [...submittedImages], "/clone", submittedImages), false);
});

test("maps clone results before new-session creation and coalesces local submissions", async () => {
  const source = await readFile(new URL("../hooks/useAgentSession.ts", import.meta.url), "utf8");
  const builtinSource = source.slice(source.indexOf("const handleBuiltinSlashCommand"));
  assert.ok(builtinSource.indexOf('if (commandName === "clone")') < builtinSource.indexOf("await ensureNewSession()"));
  assert.match(builtinSource, /cloneInFlightRef\.current/);
  for (const message of [
    "Wait for the current run to finish before cloning",
    "Nothing to clone yet",
    "Session is no longer available",
    "The selected branch changed; reload and try again",
    "Could not clone session",
    "Cloned session — available in sidebar",
  ]) {
    assert.ok(builtinSource.includes(message), `missing clone result message: ${message}`);
  }
});

test("threads clone success through refresh-only callback wiring", async () => {
  const [hookSource, windowSource, shellSource] = await Promise.all([
    readFile(new URL("../hooks/useAgentSession.ts", import.meta.url), "utf8"),
    readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8"),
    readFile(new URL("./AppShell.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(hookSource, /onSessionCloned\?\.\(\)/);
  assert.match(windowSource, /onSessionForked, onSessionCloned/);
  assert.match(shellSource, /const handleSessionCloned = useCallback\(\(\) => \{\s*setRefreshKey/);
  assert.match(shellSource, /onSessionCloned=\{handleSessionCloned\}/);

  const cloneCallback = shellSource.slice(
    shellSource.indexOf("const handleSessionCloned"),
    shellSource.indexOf("const handleInitialRestoreDone"),
  );
  assert.doesNotMatch(cloneCallback, /setSelectedSession|setSessionKey|router\.replace|setSidebarOpen/);
});
