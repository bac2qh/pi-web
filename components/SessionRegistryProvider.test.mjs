import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React, { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const { SessionRegistryProvider, useSessionRegistry } = await jiti.import("./SessionRegistryProvider.tsx");

async function source(path) { return readFile(new URL(path, import.meta.url), "utf8"); }

function createMinimalDom() {
  const noOperation = () => {};
  const makeElement = (tag, ownerDocument) => ({
    nodeType: 1,
    nodeName: tag.toUpperCase(),
    tagName: tag.toUpperCase(),
    namespaceURI: "http://www.w3.org/1999/xhtml",
    ownerDocument,
    parentNode: null,
    childNodes: [],
    style: {},
    addEventListener: noOperation,
    removeEventListener: noOperation,
    appendChild(child) { child.parentNode = this; this.childNodes.push(child); return child; },
    insertBefore(child, before) {
      child.parentNode = this;
      const index = this.childNodes.indexOf(before);
      this.childNodes.splice(index < 0 ? this.childNodes.length : index, 0, child);
      return child;
    },
    removeChild(child) {
      const index = this.childNodes.indexOf(child);
      if (index >= 0) this.childNodes.splice(index, 1);
      child.parentNode = null;
      return child;
    },
    setAttribute: noOperation,
    removeAttribute: noOperation,
    get firstChild() { return this.childNodes[0] ?? null; },
    get lastChild() { return this.childNodes.at(-1) ?? null; },
    textContent: "",
  });
  const document = {
    nodeType: 9,
    nodeName: "#document",
    namespaceURI: "http://www.w3.org/1999/xhtml",
    addEventListener: noOperation,
    removeEventListener: noOperation,
    createElement(tag) { return makeElement(tag, this); },
    createTextNode(text) { return { nodeType: 3, nodeName: "#text", nodeValue: text, data: text, ownerDocument: this, parentNode: null }; },
    defaultView: null,
  };
  const window = {
    document,
    addEventListener: noOperation,
    removeEventListener: noOperation,
    event: undefined,
    HTMLIFrameElement: class {},
    HTMLElement: class {},
    Node: class {},
  };
  document.defaultView = window;
  return { container: makeElement("div", document), document, window };
}

test("page mounts exactly one inert registry provider in the literal root nesting", async () => {
  const [page, provider] = await Promise.all([
    source("../app/page.tsx"),
    source("./SessionRegistryProvider.tsx"),
  ]);
  assert.equal((page.match(/<SessionRegistryProvider>/g) ?? []).length, 1);
  const suspense = page.indexOf("<Suspense>");
  const global = page.indexOf("<GlobalStatusProvider>");
  const registry = page.indexOf("<SessionRegistryProvider>");
  const preferences = page.indexOf("<DisplayPreferencesProvider>");
  const shell = page.indexOf("<AppShell />");
  assert.ok(suspense < global && global < registry && registry < preferences && preferences < shell);
  assert.ok(shell < page.indexOf("</DisplayPreferencesProvider>")
    && shell < page.indexOf("</SessionRegistryProvider>")
    && shell < page.indexOf("</GlobalStatusProvider>"));
  assert.match(provider, /useRef<SessionRegistryController \| null>/);
  assert.match(provider, /createRegistry = \(\) => new SessionRegistry\(\)/);
  assert.match(provider, /useEffect\(\(\) => \{/);
  assert.match(provider, /queueMicrotask/);
  assert.match(provider, /\}, \[\]\);/);
  assert.doesNotMatch(provider, /\.acquire\(|\.start\(|new WebSocket|transport\/ticket|useState/);
});

test("provider context exposes only the controller and mirrors no entry snapshots into React state", async () => {
  const provider = await source("./SessionRegistryProvider.tsx");
  assert.match(provider, /createContext<SessionRegistryController \| null>/);
  assert.match(provider, /Provider value=\{registry\}/);
  assert.doesNotMatch(provider, /getSnapshot|subscribeEffects|SessionClientSnapshot/);
});

test("actual React DOM StrictMode replay retains a usable registry and final unmount disposes it once", async () => {
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    act: globalThis.IS_REACT_ACT_ENVIRONMENT,
  };
  const dom = createMinimalDom();
  globalThis.window = dom.window;
  globalThis.document = dom.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const controllers = [];
  let exposed = null;
  function createRegistry() {
    const controller = {
      disposed: false,
      disposeCalls: 0,
      acquireCalls: 0,
      acquire() {
        if (this.disposed) throw new Error("disposed");
        this.acquireCalls += 1;
        return { release() {} };
      },
      dispose() {
        this.disposeCalls += 1;
        if (this.disposed) throw new Error("duplicate dispose");
        this.disposed = true;
      },
    };
    controllers.push(controller);
    return controller;
  }
  function Consumer() {
    exposed = useSessionRegistry();
    return React.createElement("span", null, "mounted");
  }

  try {
    const root = createRoot(dom.container);
    await React.act(async () => {
      root.render(React.createElement(
        StrictMode,
        null,
        React.createElement(SessionRegistryProvider, { createRegistry }, React.createElement(Consumer)),
      ));
    });
    await Promise.resolve();
    assert.ok(exposed);
    assert.equal(exposed.disposed, false, "StrictMode simulated cleanup is cancelled by replay setup");
    assert.doesNotThrow(() => exposed.acquire("synthetic", { ownership: "visible" }).release());
    assert.equal(exposed.acquireCalls, 1);
    assert.equal(controllers.reduce((sum, controller) => sum + controller.disposeCalls, 0), 0);

    await React.act(async () => { root.unmount(); });
    await Promise.resolve();
    assert.equal(exposed.disposed, true);
    assert.equal(exposed.disposeCalls, 1);
    assert.equal(controllers.reduce((sum, controller) => sum + controller.disposeCalls, 0), 1);
  } finally {
    globalThis.window = previous.window;
    globalThis.document = previous.document;
    globalThis.IS_REACT_ACT_ENVIRONMENT = previous.act;
  }
});

test("current product, SSE, and reconciliation surfaces do not acquire or consume the registry", async () => {
  const boundaries = await Promise.all([
    "./AppShell.tsx", "./ChatWindow.tsx", "./SessionSidebar.tsx", "../hooks/useAgentSession.ts",
  ].map(async (path) => [path, await source(path)]));
  for (const [path, text] of boundaries) {
    assert.doesNotMatch(text, /useSessionRegistry|SessionRegistry|\.acquire\(/, path);
  }
  const [hook, route] = await Promise.all([
    source("../hooks/useAgentSession.ts"), source("../app/api/agent/[id]/events/route.ts"),
  ]);
  assert.match(hook, /new EventSource\(`\/api\/agent\/\$\{encodeURIComponent\(sid\)\}\/events`\)/);
  assert.match(hook, /visibilitychange/);
  assert.match(hook, /setInterval/);
  assert.match(route, /text\/event-stream/);
});
