import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const {
  EditorAdjacentExtensionWidgets,
  ExtensionWidgets,
  EXTENSION_WIDGET_TRUNCATION_MARKER,
  MAX_EXTENSION_WIDGET_LINES,
  getExtensionWidgetDisplayLines,
  partitionExtensionWidgets,
  useExtensionWidgetDisclosureState,
} = await jiti.import("./ExtensionWidgets.tsx");

const noop = () => {};

function renderWidgets(widgets) {
  return renderToStaticMarkup(React.createElement(ExtensionWidgets, {
    widgets,
    isExpanded: () => true,
    onToggle: noop,
  }));
}

function createMinimalDom() {
  const makeEventTarget = (target) => {
    const listeners = new Map();
    target.addEventListener = (type, listener) => {
      const registered = listeners.get(type) ?? new Set();
      registered.add(listener);
      listeners.set(type, registered);
    };
    target.removeEventListener = (type, listener) => listeners.get(type)?.delete(listener);
    target.dispatchEvent = (event) => {
      if (!event.target) event.target = target;
      event.currentTarget = target;
      event.button ??= 0;
      event.defaultPrevented ??= false;
      event.preventDefault ??= () => { event.defaultPrevented = true; };
      event.stopPropagation ??= () => { event.cancelBubble = true; };
      for (const listener of [...(listeners.get(event.type) ?? [])]) listener.call(target, event);
      if (event.bubbles !== false && !event.cancelBubble && target.parentNode?.dispatchEvent) {
        target.parentNode.dispatchEvent(event);
      }
      return !event.defaultPrevented;
    };
    return target;
  };

  const makeElement = (tag, document, namespaceURI = "http://www.w3.org/1999/xhtml") => makeEventTarget({
    nodeType: 1,
    nodeName: tag.toUpperCase(),
    tagName: tag.toUpperCase(),
    namespaceURI,
    ownerDocument: document,
    parentNode: null,
    childNodes: [],
    style: {},
    attributes: {},
    disabled: false,
    hidden: false,
    textContent: "",
    focus() { document.activeElement = this; },
    click() {
      this.dispatchEvent({ type: "click", bubbles: true });
    },
    setAttribute(name, value) {
      this.attributes[name] = String(value);
      if (name === "hidden") this.hidden = true;
      else this[name] = String(value);
    },
    getAttribute(name) { return this.attributes[name] ?? null; },
    hasAttribute(name) { return Object.hasOwn(this.attributes, name); },
    removeAttribute(name) {
      delete this.attributes[name];
      if (name === "hidden") this.hidden = false;
    },
    appendChild(child) {
      child.parentNode = this;
      this.childNodes.push(child);
      return child;
    },
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
    get firstChild() { return this.childNodes[0] ?? null; },
    get lastChild() { return this.childNodes.at(-1) ?? null; },
  });

  const document = makeEventTarget({
    nodeType: 9,
    nodeName: "#document",
    namespaceURI: "http://www.w3.org/1999/xhtml",
    activeElement: null,
    createElement(tag) { return makeElement(tag, this); },
    createElementNS(namespaceURI, tag) { return makeElement(tag, this, namespaceURI); },
    createTextNode(value) {
      return {
        nodeType: 3,
        nodeName: "#text",
        nodeValue: value,
        data: value,
        ownerDocument: this,
        parentNode: null,
      };
    },
    defaultView: null,
  });
  const window = makeEventTarget({
    document,
    event: undefined,
    HTMLIFrameElement: class {},
    HTMLElement: class {},
    Node: class {},
  });
  document.defaultView = window;
  document.parentNode = window;
  return { container: makeElement("div", document), document, window };
}

function findAll(root, predicate, result = []) {
  if (predicate(root)) result.push(root);
  for (const child of root.childNodes ?? []) findAll(child, predicate, result);
  return result;
}

function elementText(root) {
  if (root.nodeType === 3) return root.nodeValue ?? "";
  const childText = (root.childNodes ?? []).map(elementText).join("");
  return childText || root.textContent || "";
}

function attribute(element, name) {
  return element.getAttribute?.(name) ?? null;
}

function widgetButton(root, key) {
  return findAll(root, (node) => node.tagName === "BUTTON" && elementText(node).trim() === key)[0] ?? null;
}

function controlledBody(root, button) {
  const id = attribute(button, "aria-controls");
  return findAll(root, (node) => attribute(node, "id") === id)[0] ?? null;
}

function containingSlot(element) {
  for (let current = element?.parentNode; current; current = current.parentNode) {
    const slot = attribute(current, "data-slot");
    if (slot) return slot;
  }
  return null;
}

function DisclosureHarness({ widgets, mobile }) {
  const { isExpanded, toggleWidget } = useExtensionWidgetDisclosureState(widgets, !mobile);
  const partitioned = partitionExtensionWidgets(widgets);
  const renderSlot = (slot, items) => React.createElement(
    "section",
    { "data-slot": slot },
    React.createElement(ExtensionWidgets, {
      widgets: items,
      isExpanded,
      onToggle: toggleWidget,
    }),
  );
  return React.createElement(
    "main",
    null,
    renderSlot("aboveEditor", partitioned.aboveEditor),
    renderSlot("belowEditor", partitioned.belowEditor),
  );
}

async function flushReactUpdate(update) {
  flushSync(update);
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
}

async function mountHarness(widgets, mobile = false, chatKey = "chat-a") {
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
  };
  const dom = createMinimalDom();
  globalThis.window = dom.window;
  globalThis.document = dom.document;
  const root = createRoot(dom.container);

  const render = async (nextWidgets, nextMobile = mobile, nextChatKey = chatKey) => {
    await flushReactUpdate(() => {
      root.render(React.createElement(DisclosureHarness, {
        key: nextChatKey,
        widgets: nextWidgets,
        mobile: nextMobile,
      }));
    });
  };

  await render(widgets, mobile, chatKey);
  return {
    dom,
    render,
    async cleanup() {
      await flushReactUpdate(() => root.unmount());
      globalThis.window = previous.window;
      globalThis.document = previous.document;
    },
  };
}

test("short, array-origin, and factory-origin widget lines share the same plain presentation", () => {
  const html = renderWidgets([
    { key: "array-origin", lines: ["array-one", "array-two"] },
    { key: "factory-origin", lines: ["factory-one", "factory-two"] },
  ]);

  assert.match(html, /array-origin/);
  assert.match(html, /array-one\narray-two/);
  assert.match(html, /factory-origin/);
  assert.match(html, /factory-one\nfactory-two/);
  assert.doesNotMatch(html, /widget truncated/);
  assert.ok(html.indexOf("array-origin") < html.indexOf("factory-origin"));
});

test("the Pi Web display policy keeps exactly ten logical lines without a marker", () => {
  const lines = Array.from({ length: MAX_EXTENSION_WIDGET_LINES }, (_, index) => `ten-${index + 1}`);
  const html = renderWidgets([{ key: "ten", lines }]);

  assert.equal(MAX_EXTENSION_WIDGET_LINES, 10);
  assert.match(html, /ten-10/);
  assert.doesNotMatch(html, /widget truncated/);
  assert.deepEqual(getExtensionWidgetDisplayLines(lines), lines);
});

test("the eleventh logical line is replaced by one truncation marker without mutating authority", () => {
  const lines = Array.from({ length: MAX_EXTENSION_WIDGET_LINES + 1 }, (_, index) => `eleven-${index + 1}`);
  const before = [...lines];
  const displayLines = getExtensionWidgetDisplayLines(lines);
  const html = renderWidgets([{ key: "eleven", lines }]);

  assert.deepEqual(lines, before, "presentation never truncates authoritative input");
  assert.equal(displayLines.length, MAX_EXTENSION_WIDGET_LINES + 1);
  assert.equal(displayLines.at(-1), EXTENSION_WIDGET_TRUNCATION_MARKER);
  assert.match(html, /eleven-10/);
  assert.doesNotMatch(html, /eleven-11/);
  assert.match(html, /\.\.\. \(widget truncated\)/);
});

test("unspecified placement defaults above and multiple widgets retain per-placement order", () => {
  const widgets = [
    { key: "default-above", lines: ["a"] },
    { key: "below-one", lines: ["b"], placement: "belowEditor" },
    { key: "explicit-above", lines: ["c"], placement: "aboveEditor" },
    { key: "below-two", lines: ["d"], placement: "belowEditor" },
  ];
  const partitioned = partitionExtensionWidgets(widgets);

  assert.deepEqual(partitioned.aboveEditor.map((widget) => widget.key), ["default-above", "explicit-above"]);
  assert.deepEqual(partitioned.belowEditor.map((widget) => widget.key), ["below-one", "below-two"]);
  assert.deepEqual(widgets.map((widget) => widget.key), ["default-above", "below-one", "explicit-above", "below-two"]);
});

test("each native disclosure controls only its own mounted body with collision-safe accessibility state", async () => {
  const unsafeKey = "widget unsafe/#?";
  const mounted = await mountHarness([
    { key: unsafeKey, lines: ["above"], placement: "aboveEditor" },
    { key: "below", lines: ["below"], placement: "belowEditor" },
  ]);

  try {
    const unsafeButton = widgetButton(mounted.dom.container, unsafeKey);
    const belowButton = widgetButton(mounted.dom.container, "below");
    assert.ok(unsafeButton && belowButton);
    assert.equal(unsafeButton.tagName, "BUTTON");
    assert.equal(attribute(unsafeButton, "type"), "button");
    assert.equal(attribute(unsafeButton, "tabindex"), null, "native button remains in normal tab order");
    assert.equal(attribute(unsafeButton, "aria-label"), `Collapse widget "${unsafeKey}"`);
    assert.equal(attribute(unsafeButton, "aria-expanded"), "true");
    assert.equal(attribute(belowButton, "aria-expanded"), "true");

    const unsafeControlId = attribute(unsafeButton, "aria-controls");
    const belowControlId = attribute(belowButton, "aria-controls");
    assert.ok(unsafeControlId && belowControlId);
    assert.notEqual(unsafeControlId, belowControlId);
    assert.equal(unsafeControlId.includes(unsafeKey), false, "extension keys are not interpolated into DOM ids");
    const unsafeBody = controlledBody(mounted.dom.container, unsafeButton);
    const belowBody = controlledBody(mounted.dom.container, belowButton);
    assert.ok(unsafeBody && belowBody);
    assert.equal(unsafeBody.hasAttribute("hidden"), false);
    assert.equal(belowBody.hasAttribute("hidden"), false);

    unsafeButton.focus();
    assert.strictEqual(mounted.dom.document.activeElement, unsafeButton);
    await flushReactUpdate(() => unsafeButton.click());
    const collapsedUnsafeButton = widgetButton(mounted.dom.container, unsafeKey);
    assert.equal(attribute(collapsedUnsafeButton, "aria-label"), `Expand widget "${unsafeKey}"`);
    assert.equal(attribute(collapsedUnsafeButton, "aria-expanded"), "false");
    assert.equal(controlledBody(mounted.dom.container, collapsedUnsafeButton).hasAttribute("hidden"), true);
    assert.equal(attribute(widgetButton(mounted.dom.container, "below"), "aria-expanded"), "true");

    await flushReactUpdate(() => widgetButton(mounted.dom.container, "below").click());
    assert.equal(attribute(widgetButton(mounted.dom.container, unsafeKey), "aria-expanded"), "false");
    assert.equal(attribute(widgetButton(mounted.dom.container, "below"), "aria-expanded"), "false");

    const [componentSource, css] = await Promise.all([
      readFile(new URL("./ExtensionWidgets.tsx", import.meta.url), "utf8"),
      readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    ]);
    assert.doesNotMatch(componentSource, /onKeyDown/, "native button owns Enter and Space semantics");
    assert.match(css, /\.extension-widget-disclosure:focus-visible/);
    assert.match(css, /\.extension-widget-disclosure\s*\{[\s\S]*?min-height: 44px;/);
  } finally {
    await mounted.cleanup();
  }
});

test("a collapsed widget stays mounted, receives latest lines, and reopens under the existing cap", async () => {
  const initialLines = Object.freeze(["initial"]);
  const mounted = await mountHarness([{ key: "live", lines: initialLines }]);

  try {
    await flushReactUpdate(() => widgetButton(mounted.dom.container, "live").click());
    const collapsedButton = widgetButton(mounted.dom.container, "live");
    const originalBody = controlledBody(mounted.dom.container, collapsedButton);
    assert.equal(originalBody.hasAttribute("hidden"), true);

    const latestLines = Object.freeze(Array.from(
      { length: MAX_EXTENSION_WIDGET_LINES + 1 },
      (_, index) => `latest-${index + 1}`,
    ));
    await mounted.render([{ key: "live", lines: latestLines }]);

    const updatedButton = widgetButton(mounted.dom.container, "live");
    const updatedBody = controlledBody(mounted.dom.container, updatedButton);
    assert.strictEqual(updatedBody, originalBody, "the controlled body is not unmounted while collapsed");
    assert.equal(updatedBody.hasAttribute("hidden"), true);
    assert.match(elementText(updatedBody), /latest-10/);
    assert.doesNotMatch(elementText(updatedBody), /latest-11/);
    assert.match(elementText(updatedBody), /\.\.\. \(widget truncated\)/);
    assert.deepEqual(initialLines, ["initial"]);
    assert.equal(latestLines.length, MAX_EXTENSION_WIDGET_LINES + 1, "authoritative input remains uncapped");

    await flushReactUpdate(() => updatedButton.click());
    const reopenedButton = widgetButton(mounted.dom.container, "live");
    assert.equal(attribute(reopenedButton, "aria-expanded"), "true");
    assert.equal(controlledBody(mounted.dom.container, reopenedButton).hasAttribute("hidden"), false);
    assert.match(elementText(controlledBody(mounted.dom.container, reopenedButton)), /latest-10/);
  } finally {
    await mounted.cleanup();
  }
});

test("explicit choices survive updates, reordering, and placement movement, then reset on removal or chat remount", async () => {
  const mounted = await mountHarness([
    { key: "alpha", lines: ["alpha-old"], placement: "aboveEditor" },
    { key: "beta", lines: ["beta-old"], placement: "belowEditor" },
  ]);

  try {
    await flushReactUpdate(() => widgetButton(mounted.dom.container, "alpha").click());
    await mounted.render([
      { key: "beta", lines: ["beta-new"], placement: "aboveEditor" },
      { key: "alpha", lines: ["alpha-new"], placement: "belowEditor" },
    ]);
    const movedAlpha = widgetButton(mounted.dom.container, "alpha");
    assert.equal(attribute(movedAlpha, "aria-expanded"), "false");
    assert.equal(containingSlot(movedAlpha), "belowEditor");
    assert.match(elementText(controlledBody(mounted.dom.container, movedAlpha)), /alpha-new/);

    await mounted.render([{ key: "beta", lines: ["beta-only"] }]);
    await mounted.render([
      { key: "beta", lines: ["beta-still"] },
      { key: "alpha", lines: ["alpha-returned"], placement: "belowEditor" },
    ]);
    assert.equal(attribute(widgetButton(mounted.dom.container, "alpha"), "aria-expanded"), "true", "removal discards the old override");

    await flushReactUpdate(() => widgetButton(mounted.dom.container, "beta").click());
    await mounted.render([
      { key: "alpha", lines: ["alpha-materialized"] },
      { key: "beta", lines: ["beta-materialized"] },
    ], false, "chat-a");
    assert.equal(attribute(widgetButton(mounted.dom.container, "beta"), "aria-expanded"), "false", "same-chat materialization preserves the override");

    await mounted.render([
      { key: "alpha", lines: ["alpha-other-chat"] },
      { key: "beta", lines: ["beta-other-chat"] },
    ], false, "chat-b");
    assert.equal(attribute(widgetButton(mounted.dom.container, "beta"), "aria-expanded"), "true", "chat remount starts from the responsive default");
  } finally {
    await mounted.cleanup();
  }
});

test("untouched widgets follow the mobile breakpoint while explicit expanded and collapsed choices remain stable", async () => {
  const widgets = [
    { key: "expanded-choice", lines: ["one"] },
    { key: "collapsed-choice", lines: ["two"] },
  ];
  const mounted = await mountHarness(widgets, true);

  try {
    for (const key of ["expanded-choice", "collapsed-choice"]) {
      assert.equal(attribute(widgetButton(mounted.dom.container, key), "aria-expanded"), "false");
    }
    await mounted.render(widgets, false);
    for (const key of ["expanded-choice", "collapsed-choice"]) {
      assert.equal(attribute(widgetButton(mounted.dom.container, key), "aria-expanded"), "true");
    }
    await mounted.render(widgets, true);
    for (const key of ["expanded-choice", "collapsed-choice"]) {
      assert.equal(attribute(widgetButton(mounted.dom.container, key), "aria-expanded"), "false");
    }

    await flushReactUpdate(() => widgetButton(mounted.dom.container, "expanded-choice").click());
    await mounted.render(widgets, false);
    await flushReactUpdate(() => widgetButton(mounted.dom.container, "collapsed-choice").click());
    assert.equal(attribute(widgetButton(mounted.dom.container, "expanded-choice"), "aria-expanded"), "true");
    assert.equal(attribute(widgetButton(mounted.dom.container, "collapsed-choice"), "aria-expanded"), "false");

    await mounted.render(widgets, true);
    assert.equal(attribute(widgetButton(mounted.dom.container, "expanded-choice"), "aria-expanded"), "true");
    assert.equal(attribute(widgetButton(mounted.dom.container, "collapsed-choice"), "aria-expanded"), "false");
    await mounted.render(widgets, false);
    assert.equal(attribute(widgetButton(mounted.dom.container, "expanded-choice"), "aria-expanded"), "true");
    assert.equal(attribute(widgetButton(mounted.dom.container, "collapsed-choice"), "aria-expanded"), "false");
  } finally {
    await mounted.cleanup();
  }
});

test("empty and established composer seams both render above, editor, then below in one bounded region", () => {
  const branch = (name) => React.createElement(
    "section",
    { "data-branch": name },
    React.createElement(EditorAdjacentExtensionWidgets, {
      aboveEditor: React.createElement("div", { "data-order": `${name}-above` }, "above"),
      editor: React.createElement("div", { "data-order": `${name}-editor` }, "editor"),
      belowEditor: React.createElement("div", { "data-order": `${name}-below` }, "below"),
    }),
  );
  const html = renderToStaticMarkup(React.createElement("main", null, branch("empty"), branch("established")));

  for (const name of ["empty", "established"]) {
    const above = html.indexOf(`data-order=\"${name}-above\"`);
    const editor = html.indexOf(`data-order=\"${name}-editor\"`);
    const below = html.indexOf(`data-order=\"${name}-below\"`);
    assert.ok(above >= 0 && above < editor && editor < below, name);
  }
  assert.match(html, /max-height:min\(100dvh, 720px\)/);
  assert.match(html, /overflow:visible/);
  assert.match(html, /flex:0 0 auto/);
});

test("ChatWindow uses one mounted-chat disclosure owner in both bounded composer branches", async () => {
  const [source, appShell] = await Promise.all([
    readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8"),
    readFile(new URL("./AppShell.tsx", import.meta.url), "utf8"),
  ]);
  const emptyBranchStart = source.indexOf("{isEmptyNew ? (");
  const establishedBranchStart = source.indexOf("\n      ) : (\n      <>", emptyBranchStart);
  const firstUse = source.indexOf("{editorWithExtensionWidgets}", emptyBranchStart);
  const secondUse = source.indexOf("{editorWithExtensionWidgets}", firstUse + 1);
  assert.ok(emptyBranchStart >= 0 && establishedBranchStart > emptyBranchStart);
  assert.ok(firstUse > emptyBranchStart && firstUse < establishedBranchStart, "empty branch uses the composer");
  assert.ok(secondUse > establishedBranchStart, "established branch uses the composer");
  assert.equal(source.indexOf("{editorWithExtensionWidgets}", secondUse + 1), -1);

  const transcriptStart = source.indexOf("ref={scrollContainerRef}");
  const transcriptEnd = source.indexOf("{isMobile ? null : (", transcriptStart);
  assert.ok(transcriptStart >= 0 && transcriptEnd > transcriptStart);
  assert.doesNotMatch(source.slice(transcriptStart, transcriptEnd), /ExtensionWidgets/);
  assert.match(source, /useExtensionWidgetDisclosureState\(extensionWidgets, !isMobile\)/);
  assert.match(source, /partitionExtensionWidgets\(extensionWidgets\)/);
  assert.match(source, /isExpanded=\{isExtensionWidgetExpanded\}/);
  assert.match(source, /onToggle=\{toggleExtensionWidget\}/);
  assert.match(source, /maxHeight: "min\(32dvh, 360px, max\(48px, calc\(100dvh - 336px\)\)\)"/);
  assert.match(source, /overflowY: "auto"/);
  assert.match(source, /className="my-auto w-full"/);
  assert.doesNotMatch(source.slice(emptyBranchStart, firstUse), /justify-center/);

  const materializationStart = appShell.indexOf("const handleSessionCreated");
  const materializationEnd = appShell.indexOf("const handleAgentEnd", materializationStart);
  assert.ok(materializationStart >= 0 && materializationEnd > materializationStart);
  assert.doesNotMatch(appShell.slice(materializationStart, materializationEnd), /setSessionKey/, "materializing the open new chat does not remount ChatWindow");
  assert.match(appShell, /<ChatWindow\s+key=\{sessionKey\}/);
  assert.doesNotMatch(`${source}\n${await readFile(new URL("./ExtensionWidgets.tsx", import.meta.url), "utf8")}`, /\b(?:local|session)Storage\b/);
});

test("short-height widget composition preserves bounded upward-opening editor menus", async () => {
  const source = await readFile(new URL("./ChatInput.tsx", import.meta.url), "utf8");
  const commandAndThinkingBound = /min\(56vh, 460px, max\(72px, calc\(100dvh - 216px\)\)\)/g;
  const fileBound = /min\(48vh, 400px, max\(72px, calc\(100dvh - 216px\)\)\)/g;
  assert.equal([...source.matchAll(commandAndThinkingBound)].length, 3);
  assert.equal([...source.matchAll(fileBound)].length, 2);
  assert.match(source, /overflowY: "auto", minWidth: 180/);
});
