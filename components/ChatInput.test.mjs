import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { isExactCloneCommand } = await jiti.import("../hooks/useAgentSession.ts");
const {
  ChatInput,
  canSubmitStreamingComposer,
  getOpenAiFastModePresentation,
  isStoredDraftTheSubmittedComposer,
  isSubmittedComposerStateUnchanged,
} = await jiti.import("./ChatInput.tsx");
const {
  PI_WEB_OPENAI_FAST_MODE_STATUS_KEY,
  splitOpenAiFastModeStatus,
} = await jiti.import("../lib/openai-fast-mode-status.ts");

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

test("clone identity stays guarded while ordinary prompts detach before pending acceptance", async () => {
  const submittedImages = [{ data: "image", mimeType: "image/png", previewUrl: "blob:test" }];

  assert.equal(isSubmittedComposerStateUnchanged("/clone", submittedImages, "/clone", submittedImages), true);
  assert.equal(isSubmittedComposerStateUnchanged("new draft", submittedImages, "/clone", submittedImages), false);
  assert.equal(isSubmittedComposerStateUnchanged("/clone", [...submittedImages], "/clone", submittedImages), false);
  assert.equal(isStoredDraftTheSubmittedComposer({ value: "/clone", images: [{ data: "image", mimeType: "image/png" }] }, "/clone", submittedImages), true);
  assert.equal(isStoredDraftTheSubmittedComposer({ value: "new draft", images: [{ data: "image", mimeType: "image/png" }] }, "/clone", submittedImages), false);
  assert.equal(isStoredDraftTheSubmittedComposer({ value: "/clone", images: [{ data: "different", mimeType: "image/png" }] }, "/clone", submittedImages), false);

  const source = await readFile(new URL("./ChatInput.tsx", import.meta.url), "utf8");
  const promptSubmission = source.slice(source.indexOf("if (pendingSubmissionRef.current) return", source.indexOf("const handleSend")), source.indexOf("const slashQuery"));
  const detach = promptSubmission.indexOf('valueRef.current = ""');
  const ordinaryAwait = promptSubmission.indexOf("await onSend");
  assert.ok(detach >= 0 && ordinaryAwait > detach, "submitted state leaves the queue editor before the blocking POST");
  assert.match(promptSubmission, /mergeFailedSubmissionText\(pending\.value, valueRef\.current\)/);
  assert.match(promptSubmission, /pending\.images\.forEach\(revokeImagePreview\)/);
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

test("reserved Fast host status is split strictly from ordinary extension statuses", () => {
  const generic = { key: "generic", text: "still visible" };
  assert.deepEqual(splitOpenAiFastModeStatus([
    generic,
    { key: PI_WEB_OPENAI_FAST_MODE_STATUS_KEY, text: "effective" },
  ]), {
    fastModeState: "effective",
    extensionStatuses: [generic],
  });
  assert.deepEqual(splitOpenAiFastModeStatus([
    { key: PI_WEB_OPENAI_FAST_MODE_STATUS_KEY, text: "enabled-ish" },
    generic,
  ]), {
    fastModeState: "unknown",
    extensionStatuses: [generic],
  });
  assert.deepEqual(splitOpenAiFastModeStatus([
    { key: PI_WEB_OPENAI_FAST_MODE_STATUS_KEY, text: "off" },
    { key: PI_WEB_OPENAI_FAST_MODE_STATUS_KEY, text: "effective" },
  ]), {
    fastModeState: "unknown",
    extensionStatuses: [],
  });
  assert.deepEqual(splitOpenAiFastModeStatus([generic]), {
    fastModeState: null,
    extensionStatuses: [generic],
  });
});

test("Fast presentation names priority-tier behavior and fails closed without a selected model", () => {
  const model = { provider: "openai", modelId: "gpt-5.4" };
  const expectedLabels = {
    effective: "Fast",
    unavailable: "Fast unavailable",
    off: "Fast off",
    unknown: "Fast unknown",
  };
  for (const [state, label] of Object.entries(expectedLabels)) {
    const presentation = getOpenAiFastModePresentation(state, model);
    assert.equal(presentation.label, label);
    assert.match(presentation.description, /OpenAI priority service tier/);
    assert.match(presentation.description, /openai\/gpt-5\.4/);
  }
  assert.deepEqual(getOpenAiFastModePresentation(null, model), null);
  const modelLess = getOpenAiFastModePresentation("effective", null);
  assert.equal(modelLess.state, "unavailable");
  assert.equal(modelLess.label, "Fast unavailable");
  assert.match(modelLess.description, /no model is selected/i);
});

test("model selector keeps every Fast label visible, accessible, and anchored while disabled", async () => {
  const baseProps = {
    onSend: () => true,
    onAbort: () => {},
    isStreaming: false,
    model: { provider: "openai", modelId: "gpt-5.4" },
    modelList: [{ provider: "openai", id: "gpt-5.4", name: "A deliberately very long selected model display name" }],
    onModelChange: () => {},
  };
  for (const [state, label] of Object.entries({
    effective: "Fast",
    unavailable: "Fast unavailable",
    off: "Fast off",
    unknown: "Fast unknown",
  })) {
    const markup = renderToStaticMarkup(React.createElement(ChatInput, {
      ...baseProps,
      isStreaming: state === "unknown",
      openAiFastModeState: state,
    }));
    assert.match(markup, new RegExp(`data-openai-fast-mode="${state}"`));
    assert.ok(markup.includes(label));
    assert.match(markup, /aria-label="Select model\. Current selected model: openai\/gpt-5\.4\./);
    assert.match(markup, /OpenAI priority service tier/);
    if (state === "unknown") assert.match(markup, /<button[^>]*disabled=""[^>]*aria-label="Select model\./);
  }

  const noModelMarkup = renderToStaticMarkup(React.createElement(ChatInput, {
    ...baseProps,
    model: null,
    openAiFastModeState: "unavailable",
  }));
  assert.match(noModelMarkup, />Select model</);
  assert.match(noModelMarkup, /Fast unavailable/);
  assert.match(noModelMarkup, /No model is selected/);

  const absentMarkup = renderToStaticMarkup(React.createElement(ChatInput, {
    ...baseProps,
    openAiFastModeState: null,
  }));
  assert.doesNotMatch(absentMarkup, /data-openai-fast-mode=/);

  const source = await readFile(new URL("./ChatInput.tsx", import.meta.url), "utf8");
  assert.match(source, /flexShrink: 0,[\s\S]*data-openai-fast-mode|data-openai-fast-mode[\s\S]*flexShrink: 0/);
  assert.match(source, /width: isMobile \? "100%" : undefined/);
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
