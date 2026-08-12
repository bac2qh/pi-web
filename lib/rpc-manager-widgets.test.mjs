import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  interopDefault: true,
  moduleCache: false,
  tsconfigPaths: true,
});
const { AgentSessionWrapper } = await jiti.import("./rpc-manager.ts");
const reducer = await jiti.import("./session-reducer.ts");

function makeInner(overrides = {}) {
  const shutdownEvents = [];
  const extensionRunner = {
    emit: async (event) => { shutdownEvents.push(event); },
    getRegisteredCommands: () => [],
    getCommand: () => undefined,
    setUIContext: () => {},
  };
  return {
    sessionId: "widget-test-session",
    sessionFile: undefined,
    isStreaming: false,
    isCompacting: false,
    autoCompactionEnabled: true,
    autoRetryEnabled: true,
    model: undefined,
    modelRuntime: { getModel: () => undefined },
    sessionManager: {
      getCwd: () => process.cwd(),
      getSessionName: () => undefined,
    },
    settingsManager: {},
    agent: { state: {} },
    extensionRunner,
    promptTemplates: [],
    resourceLoader: { getSkills: () => ({ skills: [] }) },
    subscribe: () => () => {},
    getContextUsage: () => undefined,
    getSteeringMessages: () => [],
    getFollowUpMessages: () => [],
    pendingMessageCount: 0,
    dispose: () => {},
    reload: async () => {},
    abort: async () => {},
    abortCompaction: () => {},
    shutdownEvents,
    ...overrides,
  };
}

function createContext(overrides = {}) {
  const events = [];
  const inner = makeInner(overrides);
  const wrapper = new AgentSessionWrapper(inner);
  wrapper.onEvent((event) => events.push(event));
  const context = wrapper.createExtensionUiContext();
  return { context, events, inner, wrapper, hub: wrapper.getProjectedEventHub() };
}

function widgetEvents(events) {
  return events.filter((event) => event.type === "extension_ui_request" && event.method === "setWidget");
}

function errorEvents(events) {
  return events.filter((event) => event.type === "extension_error");
}

function receive(units) {
  let receiver = reducer.createSessionReceiver();
  for (const unit of units) {
    const result = reducer.applyProjectedSessionUnit(receiver, unit);
    assert.notEqual(result.outcome, "invalid");
    receiver = result.receiver;
  }
  return receiver.state;
}

async function assertWidgetViews(wrapper, expected) {
  const state = await wrapper.send({ type: "get_state" });
  const hub = wrapper.getProjectedEventHub();
  assert.deepEqual(state.extensionWidgets, expected, "get_state widget view");
  assert.deepEqual(hub.getState().widgets, expected, "live projected widget view");
  assert.deepEqual(receive(hub.snapshot("initial")).widgets, expected, "snapshot widget view");
  assert.deepEqual(
    receive(hub.replayAfter(hub.streamEpoch, 0).units).widgets,
    expected,
    "replay widget view",
  );
}

function lastWidgetEvent(events) {
  return widgetEvents(events).at(-1);
}

function statusEvents(events) {
  return events.filter((event) => event.type === "extension_ui_request" && event.method === "setStatus");
}

function deferred() {
  let resolve;
  const promise = new Promise((next) => { resolve = next; });
  return { promise, resolve };
}

test("array widgets keep legacy events, replacement behavior, state, projection, and placement", async () => {
  const { context, events, wrapper } = createContext();

  const originalLines = ["one"];
  context.setWidget("array", originalLines, { placement: "belowEditor" });
  originalLines[0] = "mutated input";
  assert.deepEqual(lastWidgetEvent(events), {
    type: "extension_ui_request",
    id: lastWidgetEvent(events).id,
    method: "setWidget",
    widgetKey: "array",
    widgetLines: ["one"],
    widgetPlacement: "belowEditor",
  });
  await assertWidgetViews(wrapper, [{ key: "array", lines: ["one"], placement: "belowEditor" }]);
  const exposedState = await wrapper.send({ type: "get_state" });
  exposedState.extensionWidgets[0].lines[0] = "mutated response";
  await assertWidgetViews(wrapper, [{ key: "array", lines: ["one"], placement: "belowEditor" }]);

  const beforeReplace = widgetEvents(events).length;
  context.setWidget("array", ["two"]);
  assert.equal(widgetEvents(events).length, beforeReplace + 1, "array replacement remains one set event");
  assert.equal(lastWidgetEvent(events).widgetPlacement, undefined);
  await assertWidgetViews(wrapper, [{ key: "array", lines: ["two"], placement: "aboveEditor" }]);

  context.setWidget("array", undefined);
  assert.equal(lastWidgetEvent(events).widgetLines, undefined);
  await assertWidgetViews(wrapper, []);
  wrapper.destroy();
});

test("multiple widget views use the same canonical key order as projected state", async () => {
  const { context, wrapper } = createContext();

  context.setWidget("z-last", ["z"]);
  context.setWidget("a-first", ["a"]);
  await assertWidgetViews(wrapper, [
    { key: "a-first", lines: ["a"], placement: "aboveEditor" },
    { key: "z-last", lines: ["z"], placement: "aboveEditor" },
  ]);
  wrapper.destroy();
});

test("factory widgets render immediately with the fixed facade and plain-text theme", async () => {
  const { context, events, wrapper } = createContext();
  let tui;
  let theme;
  const widths = [];

  context.setWidget("factory", (receivedTui, receivedTheme) => {
    tui = receivedTui;
    theme = receivedTheme;
    return {
      render(width) {
        widths.push(width);
        return [`${width}:${tui.terminal.columns}x${tui.terminal.rows}`];
      },
    };
  }, { placement: "belowEditor" });

  assert.deepEqual(tui.terminal, { columns: 92, rows: 40, kittyProtocolActive: false });
  assert.equal(theme.bold("plain"), "plain");
  assert.equal(theme.fg("accent", "plain"), "plain");
  assert.deepEqual(widths, [92]);
  assert.deepEqual(lastWidgetEvent(events).widgetLines, ["92:92x40"]);
  assert.equal(lastWidgetEvent(events).widgetPlacement, "belowEditor");
  await assertWidgetViews(wrapper, [{ key: "factory", lines: ["92:92x40"], placement: "belowEditor" }]);
  wrapper.destroy();
});

test("authoritative server and projected widget state retain every line beyond the browser cap", async () => {
  const { context, wrapper } = createContext();
  const arrayLines = Array.from({ length: 11 }, (_, index) => `array-${index + 1}`);
  const factoryLines = Array.from({ length: 12 }, (_, index) => `factory-${index + 1}`);

  context.setWidget("uncapped-array", arrayLines);
  context.setWidget("uncapped-factory", () => ({ render: () => factoryLines }));
  await assertWidgetViews(wrapper, [
    { key: "uncapped-array", lines: arrayLines, placement: "aboveEditor" },
    { key: "uncapped-factory", lines: factoryLines, placement: "aboveEditor" },
  ]);
  wrapper.destroy();
});

test("requestRender refreshes only the current component and never recursively enters render", async () => {
  const { context, events, wrapper } = createContext();
  let tui;
  let value = "first";
  let renders = 0;

  context.setWidget("refreshable", (receivedTui) => {
    tui = receivedTui;
    return {
      render() {
        renders += 1;
        receivedTui.requestRender(true);
        return [value];
      },
    };
  });

  assert.equal(renders, 1, "render-time request is ignored");
  const before = widgetEvents(events).length;
  value = "second";
  tui.requestRender(false);
  assert.equal(renders, 2);
  assert.equal(widgetEvents(events).length, before + 1);
  await assertWidgetViews(wrapper, [{ key: "refreshable", lines: ["second"], placement: "aboveEditor" }]);

  let staleTui;
  let staleDisposed = 0;
  context.setWidget("replace", (receivedTui) => {
    staleTui = receivedTui;
    return { render: () => ["old"], dispose: () => { staleDisposed += 1; } };
  });
  context.setWidget("replace", () => ({ render: () => ["new"] }));
  assert.equal(staleDisposed, 1);
  const afterReplace = widgetEvents(events).length;
  staleTui.requestRender();
  assert.equal(widgetEvents(events).length, afterReplace, "replaced callback is a no-op");

  context.setWidget("refreshable", undefined);
  const afterClear = widgetEvents(events).length;
  tui.requestRender();
  assert.equal(widgetEvents(events).length, afterClear, "cleared callback is a no-op");
  wrapper.destroy();
});

test("array and factory transitions dispose each component exactly once and newest calls win", async () => {
  const { context, events, wrapper } = createContext();
  let firstTui;
  let firstDisposed = 0;
  context.setWidget("shared", (tui) => {
    firstTui = tui;
    return { render: () => ["factory-one"], dispose: () => { firstDisposed += 1; } };
  });

  context.setWidget("shared", ["array"]);
  assert.equal(firstDisposed, 1);
  await assertWidgetViews(wrapper, [{ key: "shared", lines: ["array"], placement: "aboveEditor" }]);
  const afterArray = widgetEvents(events).length;
  firstTui.requestRender();
  assert.equal(widgetEvents(events).length, afterArray);

  let secondTui;
  let secondDisposed = 0;
  context.setWidget("shared", (tui) => {
    secondTui = tui;
    return { render: () => ["factory-two"], dispose: () => { secondDisposed += 1; } };
  });
  await assertWidgetViews(wrapper, [{ key: "shared", lines: ["factory-two"], placement: "aboveEditor" }]);
  context.setWidget("shared", undefined);
  assert.equal(secondDisposed, 1);
  await assertWidgetViews(wrapper, []);
  const afterClear = widgetEvents(events).length;
  secondTui.requestRender();
  assert.equal(widgetEvents(events).length, afterClear);

  wrapper.destroy();
  assert.equal(firstDisposed, 1);
  assert.equal(secondDisposed, 1);
});

test("factory, component, initial render, result, and refresh failures clear only their generation safely", async () => {
  const { context, events, wrapper } = createContext();

  context.setWidget("factory secret key", () => {
    throw new Error("private prompt and provider payload");
  });
  assert.equal(lastWidgetEvent(events).widgetLines, undefined);
  assert.match(errorEvents(events).at(-1).error, /during factory \(Error\)/);
  assert.doesNotMatch(errorEvents(events).at(-1).error, /private prompt|provider payload/);
  assert.equal(Buffer.byteLength(errorEvents(events).at(-1).error, "utf8") <= 4_096, true);
  assert.equal(errorEvents(events).at(-1).extensionPath, "extension-widget:factory_secret_key");
  await assertWidgetViews(wrapper, []);

  let invalidDisposeAttempts = 0;
  const beforeInvalidErrors = errorEvents(events).length;
  context.setWidget("invalid", () => ({
    get dispose() {
      invalidDisposeAttempts += 1;
      throw new Error("private cleanup payload");
    },
  }));
  assert.equal(invalidDisposeAttempts, 1);
  assert.equal(errorEvents(events).length, beforeInvalidErrors + 2, "primary and disposal failures are reported once each");
  const invalidErrors = errorEvents(events).slice(beforeInvalidErrors);
  assert.match(invalidErrors[0].error, /component_validation/);
  assert.match(invalidErrors[1].error, /during dispose \(Error\)/);
  assert.equal(invalidErrors.every((event) => !/private cleanup/.test(event.error)), true);
  await assertWidgetViews(wrapper, []);

  let renderDisposed = 0;
  context.setWidget("render", () => ({
    render: () => { throw new RangeError("private rendered line"); },
    dispose: () => { renderDisposed += 1; },
  }));
  assert.equal(renderDisposed, 1);
  assert.match(errorEvents(events).at(-1).error, /initial_render \(RangeError\)/);
  await assertWidgetViews(wrapper, []);

  context.setWidget("lines", () => ({ render: () => ["valid", 7] }));
  assert.match(errorEvents(events).at(-1).error, /initial_render \(TypeError\)/);
  await assertWidgetViews(wrapper, []);

  let refreshTui;
  let refreshDisposed = 0;
  let refreshFails = false;
  context.setWidget("refresh", (tui) => {
    refreshTui = tui;
    return {
      render: () => {
        if (refreshFails) throw new URIError("private refresh");
        return ["live"];
      },
      dispose: () => { refreshDisposed += 1; },
    };
  });
  refreshFails = true;
  refreshTui.requestRender();
  assert.equal(refreshDisposed, 1);
  assert.match(errorEvents(events).at(-1).error, /refresh_render \(URIError\)/);
  assert.doesNotMatch(errorEvents(events).at(-1).error, /private refresh/);
  await assertWidgetViews(wrapper, []);
  const afterFailure = widgetEvents(events).length;
  refreshTui.requestRender();
  assert.equal(widgetEvents(events).length, afterFailure);

  const hostileError = new Proxy({}, { get() { throw new Error("private proxy trap"); } });
  context.setWidget("x".repeat(8_000), () => { throw hostileError; });
  const bounded = errorEvents(events).at(-1);
  assert.equal(Buffer.byteLength(bounded.error, "utf8") <= 4_096, true);
  assert.equal(Buffer.byteLength(bounded.extensionPath, "utf8") < 512, true);
  assert.match(bounded.error, /\(Error\)/);
  wrapper.destroy();
});

test("projection rejection clears and disposes the failing current factory generation", async () => {
  const { context, events, wrapper } = createContext();
  let disposed = 0;
  context.setWidget("oversized", ["old"]);
  context.setWidget("oversized", () => ({
    render: () => Array.from({ length: 100_001 }, () => "line"),
    dispose: () => { disposed += 1; },
  }));

  assert.equal(disposed, 1);
  assert.match(errorEvents(events).at(-1).error, /initial_render \(Error\)/);
  await assertWidgetViews(wrapper, []);
  wrapper.destroy();
  assert.equal(disposed, 1);
});

test("an uncommittable explicit clear retires instead of exposing a disposed stale widget owner", () => {
  const { context, events, wrapper, hub } = createContext();
  let disposed = 0;
  context.setWidget("explicit-failed-clear", () => ({
    render: () => ["live"],
    dispose: () => { disposed += 1; },
  }));
  wrapper.projectedHub.sequence = Number.MAX_SAFE_INTEGER - 2;

  context.setWidget("explicit-failed-clear", undefined);

  assert.equal(disposed, 1);
  assert.equal(wrapper.isAlive(), false);
  assert.equal(hub.isClosed(), true);
  assert.deepEqual(hub.getState().widgets, [
    { key: "explicit-failed-clear", lines: ["live"], placement: "aboveEditor" },
  ]);
  assert.ok(errorEvents(events).some((event) => /component_validation \(Error\)/.test(event.error)));
});

test("an uncommittable failure clear retires instead of exposing a disposed stale widget owner", async () => {
  const { context, events, wrapper, hub } = createContext();
  let tui;
  let fails = false;
  let disposed = 0;
  context.setWidget("failed-clear", (receivedTui) => {
    tui = receivedTui;
    return {
      render: () => {
        if (fails) throw new Error("private refresh failure");
        return ["live"];
      },
      dispose: () => { disposed += 1; },
    };
  });
  wrapper.projectedHub.sequence = Number.MAX_SAFE_INTEGER - 2;
  fails = true;

  tui.requestRender();

  assert.equal(disposed, 1);
  assert.equal(wrapper.isAlive(), false);
  assert.equal(hub.isClosed(), true);
  assert.deepEqual(hub.getState().widgets, [
    { key: "failed-clear", lines: ["live"], placement: "aboveEditor" },
  ]);
  assert.match(errorEvents(events).at(-1).error, /refresh_render \(Error\)/);
  const before = widgetEvents(events).length;
  tui.requestRender();
  context.setWidget("failed-clear", ["must-not-publish"]);
  assert.equal(widgetEvents(events).length, before);
});

test("invalid array replacement is authoritative and clears the previous factory", async () => {
  const { context, events, wrapper } = createContext();
  let disposed = 0;
  context.setWidget("invalid-array", () => ({
    render: () => ["old"],
    dispose: () => { disposed += 1; },
  }));
  context.setWidget("invalid-array", ["valid", 7]);

  assert.equal(disposed, 1);
  assert.match(errorEvents(events).at(-1).error, /component_validation \(TypeError\)/);
  await assertWidgetViews(wrapper, []);
  wrapper.destroy();
  assert.equal(disposed, 1);
});

test("dispose failures are consumed once and do not cancel the newer array operation", async () => {
  const { context, events, wrapper } = createContext();
  let disposeGets = 0;
  context.setWidget("dispose", () => ({
    render: () => ["old"],
    get dispose() {
      disposeGets += 1;
      throw new EvalError("private disposer message");
    },
  }));

  context.setWidget("dispose", ["new"]);
  assert.equal(disposeGets, 1);
  assert.match(errorEvents(events).at(-1).error, /during dispose \(EvalError\)/);
  assert.doesNotMatch(errorEvents(events).at(-1).error, /private disposer/);
  await assertWidgetViews(wrapper, [{ key: "dispose", lines: ["new"], placement: "aboveEditor" }]);

  context.setWidget("dispose", undefined);
  wrapper.destroy();
  assert.equal(disposeGets, 1, "throwing getter is never retried");
});

test("replacement, clear, creation, render failure, and publication reentrancy are last-call-wins", async () => {
  const { context, events, wrapper } = createContext();

  let replacementTui;
  context.setWidget("replace-reentrant", () => ({
    render: () => ["old"],
    dispose: () => context.setWidget("replace-reentrant", (tui) => {
      replacementTui = tui;
      return { render: () => ["nested"] };
    }),
  }));
  context.setWidget("replace-reentrant", ["outer"]);
  await assertWidgetViews(wrapper, [{ key: "replace-reentrant", lines: ["nested"], placement: "aboveEditor" }]);
  const beforeNestedRefresh = widgetEvents(events).length;
  replacementTui.requestRender();
  assert.equal(widgetEvents(events).length, beforeNestedRefresh + 1);

  context.setWidget("clear-reentrant", () => ({
    render: () => ["old"],
    dispose: () => context.setWidget("clear-reentrant", ["recovered"]),
  }));
  context.setWidget("clear-reentrant", undefined);
  assert.ok((await wrapper.send({ type: "get_state" })).extensionWidgets.some(
    (widget) => widget.key === "clear-reentrant" && widget.lines[0] === "recovered",
  ));

  let staleDisposed = 0;
  context.setWidget("factory-reentrant", () => {
    context.setWidget("factory-reentrant", ["nested-array"]);
    return { render: () => ["outer"], dispose: () => { staleDisposed += 1; } };
  });
  assert.equal(staleDisposed, 1);
  assert.ok((await wrapper.send({ type: "get_state" })).extensionWidgets.some(
    (widget) => widget.key === "factory-reentrant" && widget.lines[0] === "nested-array",
  ));

  context.setWidget("render-recovery", () => ({
    render: () => { throw new Error("render failed"); },
    dispose: () => context.setWidget("render-recovery", ["recovered"]),
  }));
  assert.ok((await wrapper.send({ type: "get_state" })).extensionWidgets.some(
    (widget) => widget.key === "render-recovery" && widget.lines[0] === "recovered",
  ));

  context.setWidget("publication", ["old"]);
  let outerFactoryCalls = 0;
  const stopReentrantListener = wrapper.onEvent((event) => {
    if (event.type === "extension_ui_request" && event.method === "setWidget"
      && event.widgetKey === "publication" && event.widgetLines === undefined) {
      context.setWidget("publication", ["listener-wins"]);
    }
  });
  context.setWidget("publication", () => {
    outerFactoryCalls += 1;
    return { render: () => ["outer"] };
  });
  stopReentrantListener();
  assert.equal(outerFactoryCalls, 0, "outer factory stops after reentrant clear publication");
  assert.ok((await wrapper.send({ type: "get_state" })).extensionWidgets.some(
    (widget) => widget.key === "publication" && widget.lines[0] === "listener-wins",
  ));

  wrapper.destroy();
});

test("a stale factory result cannot dispose a shared component adopted by the newer generation", async () => {
  const { context, wrapper } = createContext();
  let disposeCalls = 0;
  const shared = {
    render: () => ["shared-current"],
    dispose: () => { disposeCalls += 1; },
  };

  context.setWidget("shared-identity", () => {
    context.setWidget("shared-identity", () => shared);
    return shared;
  });
  assert.equal(disposeCalls, 0, "stale ownership does not dispose the current component");
  await assertWidgetViews(wrapper, [
    { key: "shared-identity", lines: ["shared-current"], placement: "aboveEditor" },
  ]);

  context.setWidget("shared-identity", undefined);
  assert.equal(disposeCalls, 1, "the final active owner disposes the shared component once");
  await assertWidgetViews(wrapper, []);
  wrapper.destroy();
  assert.equal(disposeCalls, 1);
});

test("a dispose getter cannot dispose the same component adopted by its reentrant newer generation", async () => {
  const { context, wrapper } = createContext();
  let currentTui;
  let reenter = true;
  let disposed = false;
  let disposeCalls = 0;
  const shared = {
    render: () => {
      if (disposed) throw new Error("rendered after disposal");
      return ["shared-current"];
    },
    get dispose() {
      if (reenter) {
        reenter = false;
        context.setWidget("dispose-adoption", (tui) => {
          currentTui = tui;
          return shared;
        });
      }
      return () => {
        disposed = true;
        disposeCalls += 1;
      };
    },
  };

  context.setWidget("dispose-adoption", () => shared);
  context.setWidget("dispose-adoption", ["stale-outer"]);
  assert.equal(disposeCalls, 0, "the interrupted owner does not dispose the adopted component");
  await assertWidgetViews(wrapper, [
    { key: "dispose-adoption", lines: ["shared-current"], placement: "aboveEditor" },
  ]);

  currentTui.requestRender();
  await assertWidgetViews(wrapper, [
    { key: "dispose-adoption", lines: ["shared-current"], placement: "aboveEditor" },
  ]);
  context.setWidget("dispose-adoption", undefined);
  assert.equal(disposeCalls, 1);
  await assertWidgetViews(wrapper, []);
  wrapper.destroy();
  assert.equal(disposeCalls, 1);
});

test("projected-listener reentrancy preserves legacy order and newest widget authority", async () => {
  const { context, events, wrapper, hub } = createContext();
  let nested = false;
  const attached = hub.attach(hub.streamEpoch, hub.cursor, (unit) => {
    if (unit.type !== "extension_widget_set" || unit.key !== "projection-order" || nested) return;
    nested = true;
    context.setWidget("projection-order", ["nested"]);
  });

  context.setWidget("projection-order", ["outer"]);
  attached.unsubscribe();
  const relevant = widgetEvents(events).filter((event) => event.widgetKey === "projection-order");
  assert.deepEqual(relevant.map((event) => event.widgetLines), [["outer"], ["nested"]]);
  await assertWidgetViews(wrapper, [
    { key: "projection-order", lines: ["nested"], placement: "aboveEditor" },
  ]);
  wrapper.destroy();
});

test("superseded queued clears are ordinary last-call-wins operations without failure notices", async () => {
  const { context, events, wrapper, hub } = createContext();
  context.setWidget("queued-target", ["old"]);
  let nested = false;
  const attached = hub.attach(hub.streamEpoch, hub.cursor, (unit) => {
    if (unit.type !== "extension_widget_set" || unit.key !== "queue-trigger" || nested) return;
    nested = true;
    context.setWidget("queued-target", undefined);
    context.setWidget("queued-target", ["new"]);
  });
  const beforeErrors = errorEvents(events).length;

  context.setWidget("queue-trigger", ["trigger"]);
  attached.unsubscribe();
  assert.equal(errorEvents(events).length, beforeErrors);
  assert.ok((await wrapper.send({ type: "get_state" })).extensionWidgets.some(
    (widget) => widget.key === "queued-target" && widget.lines[0] === "new",
  ));
  wrapper.destroy();
});

test("destruction reentered by a failing disposer preserves both bounded failure notices", () => {
  const { context, events, wrapper, hub } = createContext();
  const beforeErrors = errorEvents(events).length;

  context.setWidget("destroying-disposer", () => ({
    get dispose() {
      wrapper.destroy();
      throw new Error("private disposer payload");
    },
  }));

  const failures = errorEvents(events).slice(beforeErrors);
  assert.equal(failures.length, 2);
  assert.match(failures[0].error, /component_validation \(TypeError\)/);
  assert.match(failures[1].error, /during dispose \(Error\)/);
  assert.equal(failures.every((event) => !/private disposer payload/.test(event.error)), true);
  assert.equal(wrapper.isAlive(), false);
  assert.equal(hub.isClosed(), true);
});

test("all ordinary admission closes as soon as reentrant destruction begins", async () => {
  let mutations = 0;
  const { context, wrapper } = createContext({
    setThinkingLevel: () => { mutations += 1; },
  });
  let commandOutcome;
  let lateListenerEvents = 0;
  wrapper.onEvent((event) => {
    if (event.type !== "extension_ui_request" || event.method !== "setWidget"
      || event.widgetKey !== "destroy-admission" || event.widgetLines === undefined) return;
    wrapper.destroy();
    wrapper.onEvent(() => { lateListenerEvents += 1; });
    wrapper.beginExtensionBinding();
    commandOutcome = wrapper.send({ type: "set_thinking_level", level: "high" }).then(
      () => "resolved",
      () => "rejected",
    );
  });

  context.setWidget("destroy-admission", ["live"]);
  assert.equal(await commandOutcome, "rejected");
  assert.equal(mutations, 0);
  assert.equal(lateListenerEvents, 0);
  assert.equal(wrapper.isAlive(), false);
});

for (const destructionTrigger of ["projected", "legacy"]) {
  test(`${destructionTrigger} widget publication can reentrantly destroy after an authoritative clear`, async () => {
    const { context, events, wrapper, hub } = createContext();
    const projected = [];
    let triggered = false;
    let disposed = 0;
    const trigger = () => {
      if (triggered) return;
      triggered = true;
      wrapper.destroy();
    };
    const attached = hub.attach(hub.streamEpoch, hub.cursor, (unit) => {
      projected.push(unit);
      if (destructionTrigger === "projected" && unit.type === "extension_widget_set"
        && unit.key === "destroy-reentrant") trigger();
    });
    if (destructionTrigger === "legacy") {
      wrapper.onEvent((event) => {
        if (event.type === "extension_ui_request" && event.method === "setWidget"
          && event.widgetKey === "destroy-reentrant" && event.widgetLines !== undefined) trigger();
      });
    }

    context.setWidget("destroy-reentrant", () => ({
      render: () => ["live"],
      dispose: () => { disposed += 1; },
    }));
    await Promise.resolve();

    assert.equal(triggered, true);
    assert.equal(wrapper.isAlive(), false);
    assert.equal(hub.isClosed(), true);
    assert.deepEqual(hub.getState().widgets, []);
    assert.equal(disposed, 1);
    assert.ok(projected.some((unit) => unit.type === "extension_widget_set" && unit.key === "destroy-reentrant"));
    assert.ok(projected.some((unit) => unit.type === "extension_widget_cleared" && unit.key === "destroy-reentrant"));
    assert.ok(widgetEvents(events).some(
      (event) => event.widgetKey === "destroy-reentrant" && event.widgetLines === undefined,
    ));
    attached.unsubscribe();
  });
}

for (const reloadKind of ["rpc", "command-context"]) {
  test(`${reloadKind} reload clears projection, disposes once, suppresses cleanup registration, and permits new widgets`, async () => {
    const reloads = [];
    const { context, events, wrapper, hub } = createContext({
      reload: async (options) => {
        reloads.push(options);
        await options?.beforeSessionStart?.();
      },
    });
    let tui;
    let disposed = 0;
    context.setWidget("reload", (receivedTui) => {
      tui = receivedTui;
      return {
        render: () => ["live"],
        dispose: () => {
          disposed += 1;
          context.setWidget("cleanup-stale", ["must-not-publish"]);
          context.setStatus("cleanup-stale-status", "must-not-publish");
        },
      };
    });
    const cleanupCursor = hub.cursor;
    const beforeCleanupEvents = widgetEvents(events).length;

    if (reloadKind === "rpc") await wrapper.send({ type: "reload" });
    else await wrapper.createExtensionCommandContextActions().reload();

    assert.equal(reloads.length, 1);
    assert.equal(typeof reloads[0]?.beforeSessionStart, "function");
    assert.equal(disposed, 1);
    assert.deepEqual(hub.getState().widgets, []);
    assert.deepEqual(hub.getState().statuses, []);
    assert.ok(hub.replayAfter(hub.streamEpoch, cleanupCursor).units.some(
      (unit) => unit.type === "extension_widget_cleared" && unit.key === "reload",
    ));
    assert.equal(widgetEvents(events).some((event) => event.widgetKey === "cleanup-stale"), false);
    assert.equal(statusEvents(events).some((event) => event.statusKey === "cleanup-stale-status"), false);
    await assertWidgetViews(wrapper, []);

    const afterReloadEvents = widgetEvents(events).length;
    tui.requestRender();
    context.setWidget("reload", ["stale-context"]);
    context.setStatus("stale-status", "must-not-publish");
    assert.equal(widgetEvents(events).length, afterReloadEvents);
    assert.equal(statusEvents(events).some((event) => event.statusKey === "stale-status"), false);
    assert.ok(widgetEvents(events).length > beforeCleanupEvents);

    const newContext = wrapper.createExtensionUiContext();
    newContext.setWidget("reload", ["new-session"]);
    await assertWidgetViews(wrapper, [{ key: "reload", lines: ["new-session"], placement: "aboveEditor" }]);
    wrapper.destroy();
    assert.equal(disposed, 1);
  });
}

test("native bindExtensions reload replaces its auto-applied stale UI context before session start", async () => {
  let storedBindings;
  let autoAppliedContext;
  const oldRunner = {
    context: undefined,
    emit: async () => {},
    getRegisteredCommands: () => [],
    getCommand: () => undefined,
    setUIContext(context, mode) {
      assert.equal(mode, "rpc");
      this.context = context;
    },
  };
  const newRunner = { ...oldRunner, context: undefined };
  let inner;
  inner = makeInner({
    extensionRunner: oldRunner,
    bindExtensions: async (bindings) => {
      storedBindings = bindings;
      oldRunner.setUIContext(bindings.uiContext, bindings.mode);
    },
    reload: async (options) => {
      inner.extensionRunner = newRunner;
      newRunner.setUIContext(storedBindings.uiContext, storedBindings.mode);
      autoAppliedContext = newRunner.context;
      await options?.beforeSessionStart?.();
      assert.notEqual(newRunner.context, autoAppliedContext);
    },
  });
  const wrapper = new AgentSessionWrapper(inner);
  wrapper.beginExtensionBinding();
  await wrapper.waitForExtensionsBound();
  const staleContext = oldRunner.context;

  assert.deepEqual(await wrapper.send({ type: "reload" }), { success: true });
  assert.equal(inner.extensionRunner, newRunner);
  assert.notEqual(newRunner.context, staleContext);
  staleContext.setWidget("stale-native-binding", ["must-not-publish"]);
  newRunner.context.setWidget("current-native-binding", ["live"]);
  await assertWidgetViews(wrapper, [
    { key: "current-native-binding", lines: ["live"], placement: "aboveEditor" },
  ]);
  wrapper.destroy();
});

test("RPC and command-context reloads serialize and revoke every superseded runner context", async () => {
  const entered = [deferred(), deferred()];
  const release = [deferred(), deferred()];
  const rebound = [deferred(), deferred()];
  const finish = [deferred(), deferred()];
  const bound = [];
  const runners = [0, 1].map((index) => ({
    context: undefined,
    emit: async () => {},
    getRegisteredCommands: () => [],
    getCommand: () => undefined,
    setUIContext(context, mode) {
      assert.equal(mode, "rpc");
      this.context = context;
      bound.push(index);
    },
  }));
  let reloadIndex = 0;
  let nativeReloadsInFlight = 0;
  let maximumNativeReloadsInFlight = 0;
  let inner;
  inner = makeInner({
    reload: async (options) => {
      const index = reloadIndex++;
      nativeReloadsInFlight += 1;
      maximumNativeReloadsInFlight = Math.max(maximumNativeReloadsInFlight, nativeReloadsInFlight);
      entered[index].resolve();
      try {
        await release[index].promise;
        inner.extensionRunner = runners[index];
        await options?.beforeSessionStart?.();
        rebound[index].resolve();
        await finish[index].promise;
      } finally {
        nativeReloadsInFlight -= 1;
      }
    },
  });
  const wrapper = new AgentSessionWrapper(inner);
  const actions = wrapper.createExtensionCommandContextActions();

  const first = wrapper.send({ type: "reload" });
  await entered[0].promise;
  const second = actions.reload();
  await Promise.resolve();
  assert.equal(reloadIndex, 1, "second native reload remains queued");

  release[0].resolve();
  await rebound[0].promise;
  let interimDisposed = 0;
  runners[0].context.setWidget("interim", () => ({
    render: () => ["first-runner"],
    dispose: () => { interimDisposed += 1; },
  }));
  await assertWidgetViews(wrapper, [
    { key: "interim", lines: ["first-runner"], placement: "aboveEditor" },
  ]);
  finish[0].resolve();
  assert.deepEqual(await first, { success: true });
  await entered[1].promise;

  assert.equal(interimDisposed, 1, "the queued reload disposes interim ownership once");
  runners[0].context.setWidget("stale-runner", ["must-not-publish"]);
  await assertWidgetViews(wrapper, []);

  release[1].resolve();
  await rebound[1].promise;
  runners[1].context.setWidget("final-runner", ["current-context"]);
  finish[1].resolve();
  await second;

  assert.equal(maximumNativeReloadsInFlight, 1);
  assert.equal(inner.extensionRunner, runners[1]);
  assert.deepEqual(bound, [0, 1]);
  runners[0].context.setWidget("stale-after-final", ["must-not-publish"]);
  await assertWidgetViews(wrapper, [
    { key: "final-runner", lines: ["current-context"], placement: "aboveEditor" },
  ]);
  wrapper.destroy();
  assert.equal(interimDisposed, 1);
});

test("destruction promptly rejects active and queued reload callers without a second native reload", async () => {
  const entered = deferred();
  const neverFinishes = deferred();
  let nativeReloadCalls = 0;
  const { wrapper, hub } = createContext({
    reload: async () => {
      nativeReloadCalls += 1;
      entered.resolve();
      await neverFinishes.promise;
    },
  });

  const first = wrapper.send({ type: "reload" }).then(
    () => "resolved",
    (error) => error instanceof Error ? error.message : String(error),
  );
  await entered.promise;
  const second = wrapper.send({ type: "reload" }).then(
    () => "resolved",
    (error) => error instanceof Error ? error.message : String(error),
  );
  wrapper.destroy();

  assert.deepEqual(await Promise.all([first, second]), [
    "rpc_runtime_generation_closed",
    "rpc_runtime_generation_closed",
  ]);
  assert.equal(nativeReloadCalls, 1);
  assert.equal(wrapper.isAlive(), false);
  assert.equal(hub.isClosed(), true);
});

for (const reloadKind of ["rpc", "command-context"]) {
  test(`${reloadKind} native reload failure retires the invalidated wrapper`, async () => {
    let reloadCalls = 0;
    let nativeDisposeCalls = 0;
    const { context, events, wrapper, hub } = createContext({
      reload: async () => {
        reloadCalls += 1;
        throw new Error("native reload failed");
      },
      dispose: () => { nativeDisposeCalls += 1; },
    });
    let componentDisposeCalls = 0;
    context.setWidget("reload-failure", () => ({
      render: () => ["before-failure"],
      dispose: () => { componentDisposeCalls += 1; },
    }));
    const staleContext = context;
    const reload = reloadKind === "rpc"
      ? wrapper.send({ type: "reload" })
      : wrapper.createExtensionCommandContextActions().reload();

    await assert.rejects(reload, /native reload failed/);
    assert.equal(reloadCalls, 1);
    assert.equal(componentDisposeCalls, 1);
    assert.equal(nativeDisposeCalls, 1);
    assert.equal(wrapper.isAlive(), false);
    assert.equal(hub.isClosed(), true);
    assert.deepEqual(hub.getState().widgets, []);
    const beforeStaleCall = widgetEvents(events).length;
    staleContext.setWidget("reload-failure", ["must-not-publish"]);
    assert.equal(widgetEvents(events).length, beforeStaleCall);
  });
}

test("reload failure clears interim rebound widget and status authority before retirement", async () => {
  let reboundContext;
  let componentDisposeCalls = 0;
  const extensionRunner = {
    emit: async () => {},
    getRegisteredCommands: () => [],
    getCommand: () => undefined,
    setUIContext(context, mode) {
      assert.equal(mode, "rpc");
      reboundContext = context;
    },
  };
  const { wrapper, hub } = createContext({
    extensionRunner,
    reload: async (options) => {
      await options?.beforeSessionStart?.();
      reboundContext.setStatus("interim-status", "must-clear");
      reboundContext.setWidget("interim-widget", () => ({
        render: () => ["must-clear"],
        dispose: () => { componentDisposeCalls += 1; },
      }));
      throw new Error("native reload failed after rebind");
    },
  });
  const projected = [];
  hub.attach(hub.streamEpoch, hub.cursor, (unit) => projected.push(unit));

  await assert.rejects(wrapper.send({ type: "reload" }), /native reload failed after rebind/);

  assert.equal(componentDisposeCalls, 1);
  assert.equal(wrapper.isAlive(), false);
  assert.equal(hub.isClosed(), true);
  assert.deepEqual(hub.getState().statuses, []);
  assert.deepEqual(hub.getState().widgets, []);
  assert.ok(projected.some((unit) => unit.type === "extension_status_set" && unit.key === "interim-status"));
  assert.ok(projected.some((unit) => unit.type === "extension_status_cleared" && unit.key === "interim-status"));
  assert.ok(projected.some((unit) => unit.type === "extension_widget_set" && unit.key === "interim-widget"));
  assert.ok(projected.some((unit) => unit.type === "extension_widget_cleared" && unit.key === "interim-widget"));
});

for (const outerReloadKind of ["rpc", "command-context"]) {
  test(`${outerReloadKind} reload rejects reentrant command-context reload without deadlocking`, async () => {
    let actions;
    let nestedOutcome;
    let nativeReloadCalls = 0;
    const { wrapper } = createContext({
      reload: async (options) => {
        nativeReloadCalls += 1;
        if (nativeReloadCalls === 1) {
          nestedOutcome = await actions.reload().then(
            () => "resolved",
            (error) => error instanceof Error ? error.message : String(error),
          );
        }
        await options?.beforeSessionStart?.();
      },
    });
    actions = wrapper.createExtensionCommandContextActions();

    const result = outerReloadKind === "rpc"
      ? await wrapper.send({ type: "reload" })
      : await actions.reload();
    if (outerReloadKind === "rpc") assert.deepEqual(result, { success: true });
    assert.equal(nestedOutcome, "rpc_extension_reload_reentrant");
    assert.equal(nativeReloadCalls, 1);
    assert.equal(wrapper.isAlive(), true);
    wrapper.destroy();
    await wrapper.destroyCompletionPromise;
  });
}

test("native reload revokes stale widget and status callbacks before, during, and after beforeSessionStart", async () => {
  const enteredReload = deferred();
  const continueToSessionStart = deferred();
  const rebound = deferred();
  const finishReload = deferred();
  let reboundContext;
  const extensionRunner = {
    emit: async () => {},
    getRegisteredCommands: () => [],
    getCommand: () => undefined,
    setUIContext: (context, mode) => {
      assert.equal(mode, "rpc");
      reboundContext = context;
    },
  };
  const { context, events, wrapper } = createContext({
    extensionRunner,
    reload: async (options) => {
      enteredReload.resolve();
      await continueToSessionStart.promise;
      await options.beforeSessionStart();
      rebound.resolve();
      await finishReload.promise;
    },
  });
  let tui;
  context.setWidget("native-reload", (receivedTui) => {
    tui = receivedTui;
    return { render: () => ["old"] };
  });

  const reloadPromise = wrapper.send({ type: "reload" });
  await enteredReload.promise;
  const afterCleanupWidgets = widgetEvents(events).length;
  const afterCleanupStatuses = statusEvents(events).length;
  tui.requestRender();
  context.setWidget("native-reload", ["stale-before-session-start"]);
  context.setStatus("native-reload-stale", "before-session-start");
  assert.equal(widgetEvents(events).length, afterCleanupWidgets);
  assert.equal(statusEvents(events).length, afterCleanupStatuses);

  continueToSessionStart.resolve();
  await rebound.promise;
  assert.ok(reboundContext);
  reboundContext.setWidget("native-reload", ["bound-during-reload"]);
  context.setWidget("native-reload", ["stale-after-session-start"]);
  context.setStatus("native-reload-stale", "after-session-start");
  await assertWidgetViews(wrapper, [
    { key: "native-reload", lines: ["bound-during-reload"], placement: "aboveEditor" },
  ]);
  assert.equal(statusEvents(events).some((event) => event.statusKey === "native-reload-stale"), false);

  finishReload.resolve();
  await reloadPromise;
  tui.requestRender();
  context.setWidget("native-reload", ["stale-after-reload"]);
  await assertWidgetViews(wrapper, [
    { key: "native-reload", lines: ["bound-during-reload"], placement: "aboveEditor" },
  ]);
  wrapper.destroy();
});

test("status-only cleanup rejection blocks native reload without splitting local and projected authority", async () => {
  let reloadCalls = 0;
  const { context, wrapper, hub } = createContext({
    reload: async () => { reloadCalls += 1; },
  });
  context.setStatus("status-cleanup-rejected", "live");
  wrapper.projectedHub.sequence = Number.MAX_SAFE_INTEGER - 2;

  const result = await wrapper.send({ type: "reload" });
  assert.deepEqual(result, { success: false, error: "extension_widget_cleanup_rejected" });
  assert.equal(reloadCalls, 0);
  assert.equal(wrapper.isAlive(), false);
  assert.equal(hub.isClosed(), true);
  assert.deepEqual(hub.getState().statuses, [{ key: "status-cleanup-rejected", text: "live" }]);
});

test("fallback reload UI binding failure retires the partially reloaded wrapper", async () => {
  let nativeDisposeCalls = 0;
  const extensionRunner = {
    emit: async () => {},
    getRegisteredCommands: () => [],
    getCommand: () => undefined,
    setUIContext: () => { throw new Error("fallback bind failed"); },
  };
  const { wrapper, hub } = createContext({
    extensionRunner,
    reload: async () => {},
    dispose: () => { nativeDisposeCalls += 1; },
  });

  await assert.rejects(wrapper.send({ type: "reload" }), /fallback bind failed/);
  assert.equal(wrapper.isAlive(), false);
  assert.equal(hub.isClosed(), true);
  assert.equal(nativeDisposeCalls, 1);
});

test("cleanup projection rejection blocks native reload and retires stale authority", async () => {
  let reloadCalls = 0;
  const { context, events, wrapper, hub } = createContext({
    reload: async () => { reloadCalls += 1; },
  });
  let disposed = 0;
  let tui;
  context.setWidget("cleanup-rejected", (receivedTui) => {
    tui = receivedTui;
    return {
      render: () => ["retained-authority"],
      dispose: () => { disposed += 1; },
    };
  });
  wrapper.projectedHub.sequence = Number.MAX_SAFE_INTEGER - 2;

  const result = await wrapper.send({ type: "reload" });
  assert.deepEqual(result, { success: false, error: "extension_widget_cleanup_rejected" });
  assert.equal(reloadCalls, 0);
  assert.equal(disposed, 1);
  assert.equal(wrapper.isAlive(), false);
  assert.equal(hub.isClosed(), true);
  assert.deepEqual(hub.getState().widgets, [
    { key: "cleanup-rejected", lines: ["retained-authority"], placement: "aboveEditor" },
  ]);
  const before = widgetEvents(events).length;
  tui.requestRender();
  context.setWidget("cleanup-rejected", ["must-not-publish"]);
  assert.equal(widgetEvents(events).length, before);
  assert.equal(disposed, 1);
});

test("direct destruction and strict shutdown clear widgets before hub close and suppress retained callbacks", async () => {
  for (const mode of ["destroy", "shutdown"]) {
    const state = { disposeCalls: 0 };
    const { context, events, inner, wrapper, hub } = createContext({
      dispose: () => { state.disposeCalls += 1; },
    });
    let tui;
    let disposed = 0;
    context.setWidget(mode, (receivedTui) => {
      tui = receivedTui;
      return {
        render: () => ["live"],
        dispose: () => {
          disposed += 1;
          context.setWidget(`${mode}-cleanup-stale`, ["must-not-publish"]);
        },
      };
    });
    const cursor = hub.cursor;
    const projected = [];
    hub.attach(hub.streamEpoch, cursor, (unit) => projected.push(unit));

    if (mode === "destroy") wrapper.destroy();
    else await wrapper.shutdown();

    assert.equal(disposed, 1, mode);
    assert.equal(state.disposeCalls, 1, mode);
    assert.deepEqual(hub.getState().widgets, [], mode);
    assert.equal(hub.isClosed(), true, mode);
    assert.ok(projected.some((unit) => unit.type === "extension_widget_cleared" && unit.key === mode));
    assert.ok(widgetEvents(events).some((event) => event.widgetKey === mode && event.widgetLines === undefined));
    assert.equal(widgetEvents(events).some((event) => event.widgetKey === `${mode}-cleanup-stale`), false);
    if (mode === "shutdown") {
      assert.deepEqual(inner.shutdownEvents, [{ type: "session_shutdown", reason: "quit" }]);
    }

    const eventCount = widgetEvents(events).length;
    tui.requestRender();
    context.setWidget(mode, ["late"]);
    assert.equal(widgetEvents(events).length, eventCount);
  }
});

test("cleanup disposal errors are bounded, do not resurrect widgets, and do not block reload", async () => {
  let reloadCalls = 0;
  const { context, events, wrapper } = createContext({
    reload: async () => { reloadCalls += 1; },
  });
  let disposeCalls = 0;
  context.setWidget("cleanup", () => ({
    render: () => ["live"],
    dispose: () => {
      disposeCalls += 1;
      throw new ReferenceError("private cleanup body");
    },
  }));

  await wrapper.send({ type: "reload" });
  assert.equal(reloadCalls, 1);
  assert.equal(disposeCalls, 1);
  assert.match(errorEvents(events).at(-1).error, /during cleanup \(ReferenceError\)/);
  assert.doesNotMatch(errorEvents(events).at(-1).error, /private cleanup body/);
  await assertWidgetViews(wrapper, []);
  wrapper.destroy();
  assert.equal(disposeCalls, 1);
});
