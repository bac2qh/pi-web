import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import { createRoot } from "react-dom/client";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const { FileViewer } = await jiti.import("./FileViewer.tsx");
const { MarkdownBody } = await jiti.import("./MarkdownBody.tsx");
const { AutomaticFileOpenConfirmation } = await jiti.import("./AutomaticFileOpenConfirmation.tsx");
const { TEXT_PREVIEW_TOO_LARGE_ERROR, TEXT_PREVIEW_UNSUPPORTED_ERROR } = await jiti.import("../lib/file-types.ts");
const TICKET = "a".repeat(43);

function createMinimalDom() {
  const makeEventTarget = (target) => {
    const listeners = new Map();
    target.addEventListener = (type, listener) => { const set = listeners.get(type) ?? new Set(); set.add(listener); listeners.set(type, set); };
    target.removeEventListener = (type, listener) => listeners.get(type)?.delete(listener);
    target.dispatchEvent = (event) => { if (!event.target) event.target = target; event.currentTarget = target; event.button ??= 0; event.metaKey ??= false; event.ctrlKey ??= false; event.shiftKey ??= false; event.altKey ??= false; event.defaultPrevented ??= false; event.preventDefault ??= () => { event.defaultPrevented = true; }; event.stopPropagation ??= () => { event.cancelBubble = true; }; for (const listener of [...(listeners.get(event.type) ?? [])]) listener.call(target, event); if (event.bubbles !== false && !event.cancelBubble && target.parentNode?.dispatchEvent) target.parentNode.dispatchEvent(event); return !event.defaultPrevented; };
    return target;
  };
  const make = (tag, document) => makeEventTarget({
    nodeType: 1, nodeName: tag.toUpperCase(), tagName: tag.toUpperCase(), namespaceURI: "http://www.w3.org/1999/xhtml",
    ownerDocument: document, parentNode: null, childNodes: [], style: {}, attributes: {}, value: "", disabled: false,
    naturalWidth: 40, naturalHeight: 20, duration: 3,
    focus() { document.activeElement = this; },
    setAttribute(name, value) { this.attributes[name] = String(value); this[name] = String(value); }, getAttribute(name) { return this.attributes[name] ?? null; }, removeAttribute(name) { delete this.attributes[name]; },
    appendChild(child) { child.parentNode = this; this.childNodes.push(child); return child; },
    insertBefore(child, before) { child.parentNode = this; const index = this.childNodes.indexOf(before); this.childNodes.splice(index < 0 ? this.childNodes.length : index, 0, child); return child; },
    removeChild(child) { this.childNodes.splice(this.childNodes.indexOf(child), 1); child.parentNode = null; return child; },
    get firstChild() { return this.childNodes[0] ?? null; }, get lastChild() { return this.childNodes.at(-1) ?? null; }, textContent: "",
  });
  const document = makeEventTarget({
    nodeType: 9, nodeName: "#document", namespaceURI: "http://www.w3.org/1999/xhtml",
    createElement(tag) { return make(tag, this); }, createElementNS(namespace, tag) { const element = make(tag, this); element.namespaceURI = namespace; return element; },
    createTextNode(text) { return { nodeType: 3, nodeName: "#text", nodeValue: text, data: text, ownerDocument: this, parentNode: null }; }, defaultView: null, activeElement: null,
    documentElement: { classList: { contains() { return false; }, add() {}, remove() {} } },
  });
  const window = makeEventTarget({ document, location: { protocol: "http:", host: "localhost:30141" }, HTMLIFrameElement: class {}, HTMLElement: class {}, Node: class {} });
  document.defaultView = window;
  document.parentNode = window;
  return { document, window, container: make("div", document) };
}
function find(root, tag) { if (root.tagName === tag) return root; for (const child of root.childNodes ?? []) { const found = find(child, tag); if (found) return found; } return null; }
function findAll(root, predicate, result = []) { if (predicate(root)) result.push(root); for (const child of root.childNodes ?? []) findAll(child, predicate, result); return result; }
function text(root) {
  if (root.nodeType === 3) return root.nodeValue ?? "";
  const children = (root.childNodes ?? []).map(text).join("");
  return children || root.textContent || "";
}
function elementWithText(root, tag, value) { return findAll(root, (node) => node.tagName === tag && text(node).trim() === value)[0] ?? null; }
function mountedProps(node) { const key = Object.keys(node).find((value) => value.startsWith("__reactProps$")); return key ? node[key] : null; }
class FakeSocket {
  static instances = [];
  constructor(url) { this.url = url; this.readyState = 0; this.onopen = this.onmessage = this.onerror = this.onclose = null; this.closeCalls = []; FakeSocket.instances.push(this); }
  open() { this.readyState = 1; this.onopen?.({}); }
  message(frame) { this.onmessage?.({ data: JSON.stringify(frame) }); }
  close(code = 1000) { this.closeCalls.push(code); if (this.readyState === 3) return; this.readyState = 3; this.onclose?.({ code }); }
}
const frame = (type, count, exists = true, size = 12) => ({ protocol: "pi-web-file-watch", version: 1, serverInstanceId: "server", type, changeCount: count, exists, size: exists ? size : 0 });
async function flush() { await new Promise((resolve) => setImmediate(resolve)); }
function deferred() { let resolve, reject; const promise = new Promise((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject }; }

test("mounted viewer owns one current-path client, refreshes media, switches exactly, and stops on unmount", async () => {
  const previous = { window: globalThis.window, document: globalThis.document, WebSocket: globalThis.WebSocket, fetch: globalThis.fetch, act: globalThis.IS_REACT_ACT_ENVIRONMENT };
  const dom = createMinimalDom(); FakeSocket.instances = [];
  globalThis.window = dom.window; globalThis.document = dom.document; globalThis.WebSocket = FakeSocket; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const requests = [];
  globalThis.fetch = async (input, init) => { requests.push({ input, init }); return new Response(JSON.stringify({ ticket: TICKET, expiresAt: 10 }), { status: 200, headers: { "Content-Type": "application/json" } }); };
  const root = createRoot(dom.container);
  try {
    await React.act(async () => { root.render(React.createElement(FileViewer, { filePath: "/synthetic/a.png", sourceSessionId: "source" })); await flush(); });
    assert.equal(FakeSocket.instances.length, 1);
    assert.deepEqual(JSON.parse(requests[0].init.body), { channel: "file-watch", path: "/synthetic/a.png", sessionId: "source" });
    const imageSocket = FakeSocket.instances[0]; imageSocket.open();
    await React.act(async () => imageSocket.message(frame("connected", 0)));
    assert.match(text(dom.container), /live/);
    const image = find(dom.container, "IMG"); assert.ok(image);
    const firstSrc = image.src;
    await React.act(async () => imageSocket.message(frame("change", 1, false)));
    assert.match(text(dom.container), /File not found/);
    await React.act(async () => imageSocket.message(frame("change", 2, true, 18)));
    const recoveredImage = find(dom.container, "IMG"); assert.ok(recoveredImage);
    assert.notEqual(recoveredImage.src, firstSrc);
    await React.act(async () => recoveredImage.dispatchEvent({ type: "load", bubbles: false }));
    assert.match(text(dom.container), /40 × 20/);

    await React.act(async () => { root.render(React.createElement(FileViewer, { filePath: "/synthetic/b.mp3", sourceSessionId: "source" })); await flush(); });
    assert.equal(imageSocket.closeCalls.includes(1000), true);
    assert.equal(FakeSocket.instances.length, 2);
    assert.deepEqual(JSON.parse(requests.at(-1).init.body).path, "/synthetic/b.mp3");
    const audioSocket = FakeSocket.instances[1]; audioSocket.open(); await React.act(async () => audioSocket.message(frame("connected", 0)));
    assert.ok(find(dom.container, "AUDIO"));
    await React.act(async () => root.unmount());
    assert.equal(audioSocket.closeCalls.includes(1000), true);
  } finally {
    globalThis.window = previous.window; globalThis.document = previous.document; globalThis.WebSocket = previous.WebSocket; globalThis.fetch = previous.fetch; globalThis.IS_REACT_ACT_ENVIRONMENT = previous.act;
  }
});

test("mounted text and document viewers synchronize without false diffs and recover after read errors", async () => {
  const previous = { window: globalThis.window, document: globalThis.document, WebSocket: globalThis.WebSocket, fetch: globalThis.fetch, act: globalThis.IS_REACT_ACT_ENVIRONMENT };
  const dom = createMinimalDom(); FakeSocket.instances = [];
  globalThis.window = dom.window; globalThis.document = dom.document; globalThis.WebSocket = FakeSocket; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let content = "one";
  let readError = null;
  let metaSize = 20;
  const requests = [];
  globalThis.fetch = async (input, init) => {
    requests.push({ input, init });
    if (input === "/api/transport/ticket") return new Response(JSON.stringify({ ticket: TICKET, expiresAt: 10 }), { status: 200, headers: { "Content-Type": "application/json" } });
    if (String(input).includes("type=meta")) return Response.json({ size: metaSize });
    if (String(input).includes("type=read")) return Response.json(readError ? { error: readError } : { content, language: "text", size: content.length });
    return new Response("", { status: 200 });
  };
  const root = createRoot(dom.container);
  try {
    await React.act(async () => { root.render(React.createElement(FileViewer, { filePath: "/synthetic/a.txt" })); await flush(); await flush(); });
    const textSocket = FakeSocket.instances[0]; textSocket.open();
    await React.act(async () => { textSocket.message(frame("connected", 0, true, 3)); await flush(); await flush(); });
    assert.doesNotMatch(text(dom.container), /Diff \+1/, "unchanged connected synchronization creates no diff");
    content = "two";
    await React.act(async () => { textSocket.message(frame("change", 1, true, 3)); await flush(); await flush(); });
    assert.match(text(dom.container), /Diff \+1/);
    readError = "Not found";
    await React.act(async () => { textSocket.message(frame("change", 2, false)); await flush(); await flush(); });
    assert.match(text(dom.container), /Not found/);
    readError = TEXT_PREVIEW_UNSUPPORTED_ERROR;
    await React.act(async () => { textSocket.message(frame("change", 3, true, 5)); await flush(); await flush(); });
    assert.match(text(dom.container), new RegExp(TEXT_PREVIEW_UNSUPPORTED_ERROR.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    readError = TEXT_PREVIEW_TOO_LARGE_ERROR;
    await React.act(async () => { textSocket.message(frame("change", 4, true, 5)); await flush(); await flush(); });
    assert.match(text(dom.container), new RegExp(TEXT_PREVIEW_TOO_LARGE_ERROR.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    readError = null; content = "three";
    await React.act(async () => { textSocket.message(frame("change", 5, true, 5)); await flush(); await flush(); });
    assert.doesNotMatch(text(dom.container), /Unsupported or binary|File too large|Not found/);

    await React.act(async () => { root.render(React.createElement(FileViewer, { filePath: "/synthetic/a.pdf" })); await flush(); await flush(); });
    assert.equal(textSocket.closeCalls.includes(1000), true);
    const pdfSocket = FakeSocket.instances.at(-1); pdfSocket.open();
    await React.act(async () => { pdfSocket.message(frame("connected", 0, true, metaSize)); await flush(); await flush(); });
    const iframe = find(dom.container, "IFRAME");
    assert.ok(iframe);
    assert.equal(iframe.attributes.sandbox, undefined);
    assert.match(iframe.src, /type=read/);

    metaSize = 10 * 1024 * 1024 + 1;
    await React.act(async () => { root.render(React.createElement(FileViewer, { filePath: "/synthetic/a.docx" })); await flush(); await flush(); });
    assert.match(text(dom.container), /DOCX too large for preview/);
    await React.act(async () => root.unmount());
  } finally {
    globalThis.window = previous.window; globalThis.document = previous.document; globalThis.WebSocket = previous.WebSocket; globalThis.fetch = previous.fetch; globalThis.IS_REACT_ACT_ENVIRONMENT = previous.act;
  }
});

test("deferred initial/read/meta and detached iframe callbacks cannot overwrite newer deletion state", async () => {
  const previous = { window: globalThis.window, document: globalThis.document, WebSocket: globalThis.WebSocket, fetch: globalThis.fetch, act: globalThis.IS_REACT_ACT_ENVIRONMENT };
  const dom = createMinimalDom(); FakeSocket.instances = [];
  globalThis.window = dom.window; globalThis.document = dom.document; globalThis.WebSocket = FakeSocket; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const reads = [], metas = [];
  globalThis.fetch = async (input) => {
    if (input === "/api/transport/ticket") return new Response(JSON.stringify({ ticket: TICKET, expiresAt: 10 }), { status: 200, headers: { "Content-Type": "application/json" } });
    const pending = deferred();
    if (String(input).includes("type=read")) reads.push(pending); else if (String(input).includes("type=meta")) metas.push(pending);
    return pending.promise;
  };
  const root = createRoot(dom.container);
  try {
    await React.act(async () => { root.render(React.createElement(FileViewer, { filePath: "/synthetic/deferred.txt" })); await flush(); });
    const textSocket = FakeSocket.instances[0]; textSocket.open();
    await React.act(async () => textSocket.message(frame("connected", 0, true, 3)));
    reads[0].resolve(Response.json({ content: "stale", language: "text", size: 5 }));
    await React.act(async () => { await flush(); await flush(); });
    assert.equal(reads.length, 2);
    await React.act(async () => textSocket.message(frame("change", 1, false)));
    reads[1].resolve(Response.json({ content: "also stale", language: "text", size: 10 }));
    await React.act(async () => { await flush(); await flush(); });
    assert.match(text(dom.container), /File not found/);
    assert.equal(reads.length, 3);
    reads[2].resolve(Response.json({ content: "recreated", language: "text", size: 9 }));
    await React.act(async () => { await flush(); await flush(); });
    assert.match(text(dom.container), /recreated/);

    await React.act(async () => { root.render(React.createElement(FileViewer, { filePath: "/synthetic/deferred.pdf" })); await flush(); });
    const oldIframe = find(dom.container, "IFRAME"); assert.ok(oldIframe);
    const docSocket = FakeSocket.instances.at(-1); docSocket.open();
    await React.act(async () => docSocket.message(frame("connected", 0, false)));
    await React.act(async () => oldIframe.dispatchEvent({ type: "load", bubbles: false }));
    assert.match(text(dom.container), /File not found/);
    metas[0].resolve(Response.json({ size: 10 }));
    await React.act(async () => { await flush(); await flush(); });
    assert.equal(metas.length, 2);
    assert.match(text(dom.container), /File not found/);
    metas[1].resolve(Response.json({ size: 10 }));
    await React.act(async () => { await flush(); await flush(); });
    assert.ok(find(dom.container, "IFRAME"));
    await React.act(async () => root.unmount());
  } finally {
    globalThis.window = previous.window; globalThis.document = previous.document; globalThis.WebSocket = previous.WebSocket; globalThis.fetch = previous.fetch; globalThis.IS_REACT_ACT_ENVIRONMENT = previous.act;
  }
});

test("audio deletion, recreation, later modification, and detached native callbacks converge", async () => {
  const previous = { window: globalThis.window, document: globalThis.document, WebSocket: globalThis.WebSocket, fetch: globalThis.fetch, act: globalThis.IS_REACT_ACT_ENVIRONMENT };
  const dom = createMinimalDom(); FakeSocket.instances = [];
  globalThis.window = dom.window; globalThis.document = dom.document; globalThis.WebSocket = FakeSocket; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.fetch = async () => new Response(JSON.stringify({ ticket: TICKET, expiresAt: 10 }), { status: 200, headers: { "Content-Type": "application/json" } });
  const root = createRoot(dom.container);
  try {
    await React.act(async () => { root.render(React.createElement(FileViewer, { filePath: "/synthetic/audio.wav", sourceSessionId: "source" })); await flush(); });
    const socket = FakeSocket.instances[0]; socket.open();
    await React.act(async () => socket.message(frame("connected", 0, true, 44)));
    const original = find(dom.container, "AUDIO"); assert.ok(original);
    await React.act(async () => original.dispatchEvent({ type: "error", bubbles: false }));
    assert.match(text(dom.container), /Failed to load audio/);
    await React.act(async () => socket.message(frame("change", 1, false)));
    assert.match(text(dom.container), /File not found/);
    await React.act(async () => socket.message(frame("change", 2, true, 88)));
    const recreated = find(dom.container, "AUDIO"); assert.ok(recreated);
    assert.notEqual(recreated.src, original.src);
    assert.doesNotMatch(text(dom.container), /File not found|Failed to load audio/);
    await React.act(async () => original.dispatchEvent({ type: "loadedmetadata", bubbles: false }));
    assert.doesNotMatch(text(dom.container), /0:03/, "detached audio metadata cannot update current duration");
    await React.act(async () => recreated.dispatchEvent({ type: "loadedmetadata", bubbles: false }));
    assert.match(text(dom.container), /0:03/);
    const recreatedSrc = recreated.src;
    await React.act(async () => socket.message(frame("change", 3, true, 96)));
    const modified = find(dom.container, "AUDIO"); assert.notEqual(modified.src, recreatedSrc);
    assert.doesNotMatch(text(dom.container), /0:03/, "later modification clears stale duration");
    await React.act(async () => root.unmount());
    assert.deepEqual(socket.closeCalls, [1000]);
  } finally {
    globalThis.window = previous.window; globalThis.document = previous.document; globalThis.WebSocket = previous.WebSocket; globalThis.fetch = previous.fetch; globalThis.IS_REACT_ACT_ENVIRONMENT = previous.act;
  }
});

test("PDF and DOCX deletion, recreation, later modification, error clearing, and iframe epochs converge", async () => {
  const previous = { window: globalThis.window, document: globalThis.document, WebSocket: globalThis.WebSocket, fetch: globalThis.fetch, act: globalThis.IS_REACT_ACT_ENVIRONMENT };
  const dom = createMinimalDom(); FakeSocket.instances = [];
  globalThis.window = dom.window; globalThis.document = dom.document; globalThis.WebSocket = FakeSocket; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const present = new Map([["/synthetic/file.pdf", true], ["/synthetic/file.docx", true]]);
  globalThis.fetch = async (input) => {
    if (input === "/api/transport/ticket") return new Response(JSON.stringify({ ticket: TICKET, expiresAt: 10 }), { status: 200, headers: { "Content-Type": "application/json" } });
    const decoded = decodeURIComponent(String(input));
    const target = decoded.includes("file.docx") ? "/synthetic/file.docx" : "/synthetic/file.pdf";
    return Response.json(present.get(target) ? { size: 32 } : { error: "Not found" });
  };
  const root = createRoot(dom.container);
  try {
    for (const [index, target] of ["/synthetic/file.pdf", "/synthetic/file.docx"].entries()) {
      await React.act(async () => { root.render(React.createElement(FileViewer, { filePath: target, sourceSessionId: "source" })); await flush(); await flush(); });
      const socket = FakeSocket.instances[index]; socket.open();
      await React.act(async () => { socket.message(frame("connected", 0, true, 32)); await flush(); await flush(); await flush(); await flush(); });
      const initial = find(dom.container, "IFRAME"); assert.ok(initial);
      assert.match(initial.src, target.endsWith(".pdf") ? /type=read/ : /type=preview/);
      if (target.endsWith(".docx")) assert.equal(initial.attributes.sandbox, "");
      const staleOnError = mountedProps(initial).onError;
      await React.act(async () => staleOnError());
      assert.match(text(dom.container), /Failed to load document preview/);

      present.set(target, false);
      await React.act(async () => { socket.message(frame("change", 1, false)); await flush(); await flush(); });
      assert.match(text(dom.container), /Not found|File not found/);
      present.set(target, true);
      await React.act(async () => { socket.message(frame("change", 2, true, 48)); await flush(); await flush(); });
      const recreated = find(dom.container, "IFRAME"); assert.ok(recreated);
      assert.notEqual(recreated.src, initial.src);
      assert.doesNotMatch(text(dom.container), /Not found|File not found|Failed to load document preview/);
      await React.act(async () => staleOnError());
      assert.ok(find(dom.container, "IFRAME"), "detached iframe callback cannot replace the current preview");
      const recreatedSrc = recreated.src;
      await React.act(async () => { socket.message(frame("change", 3, true, 64)); await flush(); await flush(); });
      assert.notEqual(find(dom.container, "IFRAME").src, recreatedSrc);
    }
    await React.act(async () => root.unmount());
    assert.deepEqual(FakeSocket.instances.map((socket) => socket.closeCalls), [[1000], [1000]]);
  } finally {
    globalThis.window = previous.window; globalThis.document = previous.document; globalThis.WebSocket = previous.WebSocket; globalThis.fetch = previous.fetch; globalThis.IS_REACT_ACT_ENVIRONMENT = previous.act;
  }
});

test("text, Markdown, and HTML retain unchanged, diff, preview, wrap, download, and linked-file behavior", async () => {
  const previous = { window: globalThis.window, document: globalThis.document, WebSocket: globalThis.WebSocket, fetch: globalThis.fetch, act: globalThis.IS_REACT_ACT_ENVIRONMENT };
  const dom = createMinimalDom(); FakeSocket.instances = [];
  globalThis.window = dom.window; globalThis.document = dom.document; globalThis.WebSocket = FakeSocket; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const files = new Map([
    ["plain.txt", { content: "one", language: "text" }],
    ["notes.md", { content: "# Heading\n[open](linked.txt)", language: "markdown" }],
    ["page.html", { content: "<strong>hello</strong>", language: "html" }],
  ]);
  globalThis.fetch = async (input) => {
    if (input === "/api/transport/ticket") return new Response(JSON.stringify({ ticket: TICKET, expiresAt: 10 }), { status: 200, headers: { "Content-Type": "application/json" } });
    const decoded = decodeURIComponent(String(input));
    const value = [...files].find(([candidate]) => decoded.includes(candidate))[1];
    return Response.json({ ...value, size: value.content.length });
  };
  const opened = [];
  const root = createRoot(dom.container);
  try {
    await React.act(async () => { root.render(React.createElement(FileViewer, { filePath: "/synthetic/plain.txt", sourceSessionId: "source" })); await flush(); await flush(); });
    const plainSocket = FakeSocket.instances[0]; plainSocket.open();
    await React.act(async () => { plainSocket.message(frame("connected", 0)); await flush(); await flush(); });
    assert.doesNotMatch(text(dom.container), /Diff \+1/);
    const wrap = elementWithText(dom.container, "BUTTON", "wrap"); assert.ok(wrap);
    await React.act(async () => wrap.dispatchEvent({ type: "click", bubbles: true }));
    assert.equal(wrap.style.background, "var(--bg-selected)");
    files.set("plain.txt", { content: "two", language: "text" });
    await React.act(async () => { plainSocket.message(frame("change", 1)); await flush(); await flush(); });
    assert.match(text(dom.container), /Diff \+1/);
    const diff = elementWithText(dom.container, "BUTTON", "Diff +1"); assert.ok(diff);
    await React.act(async () => diff.dispatchEvent({ type: "click", bubbles: true }));
    assert.match(text(dom.container), /[-+]one|[-+]two/);

    await React.act(async () => { root.render(React.createElement(FileViewer, { filePath: "/synthetic/notes.md", cwd: "/synthetic", sourceSessionId: "source", onOpenFile: (value) => opened.push(value) })); await flush(); await flush(); });
    assert.ok(elementWithText(dom.container, "BUTTON", "Raw"), "Markdown defaults to preview");
    const localLink = elementWithText(dom.container, "A", "open"); assert.ok(localLink);
    await React.act(async () => localLink.dispatchEvent({ type: "click", bubbles: true }));
    assert.deepEqual(opened, ["/synthetic/linked.txt"]);
    const download = findAll(dom.container, (node) => node.tagName === "A" && node.attributes.title === "Download file")[0];
    assert.match(download.href, /type=download/); assert.match(download.href, /sessionId=source/);
    await React.act(async () => elementWithText(dom.container, "BUTTON", "Raw").dispatchEvent({ type: "click", bubbles: true }));
    assert.ok(elementWithText(dom.container, "BUTTON", "wrap"));

    await React.act(async () => { root.render(React.createElement(FileViewer, { filePath: "/synthetic/page.html" })); await flush(); await flush(); });
    assert.ok(elementWithText(dom.container, "BUTTON", "Preview"));
    await React.act(async () => elementWithText(dom.container, "BUTTON", "Preview").dispatchEvent({ type: "click", bubbles: true }));
    assert.equal(find(dom.container, "IFRAME").srcDoc, "<strong>hello</strong>");
    await React.act(async () => root.unmount());
  } finally {
    globalThis.window = previous.window; globalThis.document = previous.document; globalThis.WebSocket = previous.WebSocket; globalThis.fetch = previous.fetch; globalThis.IS_REACT_ACT_ENVIRONMENT = previous.act;
  }
});

test("path and source-session switches suppress deferred read and meta responses", async () => {
  const previous = { window: globalThis.window, document: globalThis.document, WebSocket: globalThis.WebSocket, fetch: globalThis.fetch, act: globalThis.IS_REACT_ACT_ENVIRONMENT };
  const dom = createMinimalDom(); FakeSocket.instances = [];
  globalThis.window = dom.window; globalThis.document = dom.document; globalThis.WebSocket = FakeSocket; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const reads = [], metas = [];
  globalThis.fetch = (input) => {
    if (input === "/api/transport/ticket") return Promise.resolve(new Response(JSON.stringify({ ticket: TICKET, expiresAt: 10 }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const pending = deferred();
    if (String(input).includes("type=meta")) metas.push({ input: String(input), pending }); else reads.push({ input: String(input), pending });
    return pending.promise;
  };
  const root = createRoot(dom.container);
  try {
    await React.act(async () => { root.render(React.createElement(FileViewer, { filePath: "/synthetic/old.txt", sourceSessionId: "old" })); await flush(); });
    await React.act(async () => { root.render(React.createElement(FileViewer, { filePath: "/synthetic/new.txt", sourceSessionId: "new" })); await flush(); });
    reads[1].pending.resolve(Response.json({ content: "current", language: "text", size: 7 }));
    await React.act(async () => { await flush(); await flush(); });
    reads[0].pending.resolve(Response.json({ content: "stale", language: "text", size: 5 }));
    await React.act(async () => { await flush(); await flush(); });
    assert.match(text(dom.container), /current/); assert.doesNotMatch(text(dom.container), /stale/);

    await React.act(async () => { root.render(React.createElement(FileViewer, { filePath: "/synthetic/file.pdf", sourceSessionId: "old" })); await flush(); });
    await React.act(async () => { root.render(React.createElement(FileViewer, { filePath: "/synthetic/file.pdf", sourceSessionId: "new" })); await flush(); });
    metas[1].pending.resolve(Response.json({ size: 22 }));
    await React.act(async () => { await flush(); await flush(); });
    metas[0].pending.resolve(Response.json({ size: 99 }));
    await React.act(async () => { await flush(); await flush(); });
    assert.match(text(dom.container), /22 B/); assert.doesNotMatch(text(dom.container), /99 B/);
    assert.match(find(dom.container, "IFRAME").src, /sessionId=new/);
    await React.act(async () => root.unmount());
  } finally {
    globalThis.window = previous.window; globalThis.document = previous.document; globalThis.WebSocket = previous.WebSocket; globalThis.fetch = previous.fetch; globalThis.IS_REACT_ACT_ENVIRONMENT = previous.act;
  }
});

test("path and source-session switches invalidate deferred bootstrap and reconnect, while StrictMode/unmount clean exactly", async () => {
  const previous = { window: globalThis.window, document: globalThis.document, WebSocket: globalThis.WebSocket, fetch: globalThis.fetch, act: globalThis.IS_REACT_ACT_ENVIRONMENT };
  const dom = createMinimalDom(); FakeSocket.instances = [];
  globalThis.window = dom.window; globalThis.document = dom.document; globalThis.WebSocket = FakeSocket; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const tickets = [];
  globalThis.fetch = (input, init) => {
    if (input === "/api/transport/ticket") { const pending = deferred(); tickets.push({ pending, init }); return pending.promise; }
    return Promise.resolve(Response.json({ content: "current", language: "text", size: 7 }));
  };
  const root = createRoot(dom.container);
  try {
    await React.act(async () => { root.render(React.createElement(FileViewer, { filePath: "/synthetic/old.png", sourceSessionId: "old" })); await flush(); });
    const oldSignal = tickets[0].init.signal;
    await React.act(async () => { root.render(React.createElement(FileViewer, { filePath: "/synthetic/new.png", sourceSessionId: "new" })); await flush(); });
    assert.equal(oldSignal.aborted, true);
    tickets[0].pending.resolve(new Response(JSON.stringify({ ticket: TICKET, expiresAt: 10 }), { status: 200, headers: { "Content-Type": "application/json" } }));
    tickets[1].pending.resolve(new Response(JSON.stringify({ ticket: TICKET, expiresAt: 10 }), { status: 200, headers: { "Content-Type": "application/json" } }));
    await React.act(async () => { await flush(); await flush(); });
    assert.equal(FakeSocket.instances.length, 1);
    assert.deepEqual(JSON.parse(tickets[1].init.body), { channel: "file-watch", path: "/synthetic/new.png", sessionId: "new" });
    const current = FakeSocket.instances[0]; current.open(); await React.act(async () => current.message(frame("connected", 0)));
    await React.act(async () => current.close(1012));
    await React.act(async () => { root.render(React.createElement(FileViewer, { filePath: "/synthetic/new.png", sourceSessionId: "newer" })); await flush(); });
    assert.deepEqual(JSON.parse(tickets.at(-1).init.body), { channel: "file-watch", path: "/synthetic/new.png", sessionId: "newer" });
    tickets.at(-1).pending.resolve(new Response(JSON.stringify({ ticket: TICKET, expiresAt: 10 }), { status: 200, headers: { "Content-Type": "application/json" } }));
    await React.act(async () => { await flush(); await flush(); });
    assert.equal(FakeSocket.instances.length, 2);
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(tickets.length, 3, "stopped reconnect epoch cannot bootstrap again");
    await React.act(async () => root.unmount());
    assert.deepEqual(FakeSocket.instances.map((socket) => socket.closeCalls.filter((code) => code === 1000).length), [0, 1]);

    FakeSocket.instances = []; tickets.length = 0;
    const strictRoot = createRoot(dom.container);
    await React.act(async () => { strictRoot.render(React.createElement(React.StrictMode, null, React.createElement(FileViewer, { filePath: "/synthetic/strict.png" }))); await flush(); });
    for (const entry of tickets) entry.pending.resolve(new Response(JSON.stringify({ ticket: TICKET, expiresAt: 10 }), { status: 200, headers: { "Content-Type": "application/json" } }));
    await React.act(async () => { await flush(); await flush(); });
    assert.equal(tickets.length, 2);
    assert.equal(tickets[0].init.signal.aborted, true);
    assert.equal(FakeSocket.instances.length, 1);
    await React.act(async () => strictRoot.unmount());
    assert.deepEqual(FakeSocket.instances[0].closeCalls, [1000]);
  } finally {
    globalThis.window = previous.window; globalThis.document = previous.document; globalThis.WebSocket = previous.WebSocket; globalThis.fetch = previous.fetch; globalThis.IS_REACT_ACT_ENVIRONMENT = previous.act;
  }
});

test("StrictMode text refresh records one pure transition for one changed accepted response", async () => {
  const previous = { window: globalThis.window, document: globalThis.document, WebSocket: globalThis.WebSocket, fetch: globalThis.fetch, act: globalThis.IS_REACT_ACT_ENVIRONMENT };
  const dom = createMinimalDom(); FakeSocket.instances = [];
  globalThis.window = dom.window; globalThis.document = dom.document; globalThis.WebSocket = FakeSocket; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let content = "one";
  let readResponses = 0;
  globalThis.fetch = async (input) => {
    if (input === "/api/transport/ticket") return new Response(JSON.stringify({ ticket: TICKET, expiresAt: 10 }), { status: 200, headers: { "Content-Type": "application/json" } });
    readResponses += 1;
    return Response.json({ content, language: "text", size: content.length });
  };
  const root = createRoot(dom.container);
  const originalConsoleError = console.error;
  const renderErrors = [];
  try {
    await React.act(async () => { root.render(React.createElement(React.StrictMode, null, React.createElement(FileViewer, { filePath: "/synthetic/strict.txt" }))); await flush(); await flush(); });
    const socket = FakeSocket.instances.at(-1); assert.ok(socket);
    socket.open();
    await React.act(async () => { socket.message(frame("connected", 0, true, content.length)); await flush(); await flush(); });
    assert.doesNotMatch(text(dom.container), /Diff \+\d+/);

    const beforeChangedResponse = readResponses;
    console.error = (...args) => { renderErrors.push(args.map(String).join(" ")); };
    content = "two";
    await React.act(async () => { socket.message(frame("change", 1, true, content.length)); await flush(); await flush(); });
    console.error = originalConsoleError;

    assert.equal(readResponses, beforeChangedResponse + 1, "one watch change yields one accepted changed response");
    assert.deepEqual(findAll(dom.container, (node) => node.tagName === "BUTTON" && /^Diff \+\d+$/.test(text(node).trim())).map((node) => text(node).trim()), ["Diff +1"]);
    assert.equal(renderErrors.some((message) => /cannot update.*render|rendering a different component|setstate.*render/i.test(message)), false, "the transition performs no render-phase update");
    await React.act(async () => root.unmount());
  } finally {
    console.error = originalConsoleError;
    globalThis.window = previous.window; globalThis.document = previous.document; globalThis.WebSocket = previous.WebSocket; globalThis.fetch = previous.fetch; globalThis.IS_REACT_ACT_ENVIRONMENT = previous.act;
  }
});

test("automatic file confirmation owns focus, keyboard, backdrop, cancel, and confirm behavior", async () => {
  const previous = { window: globalThis.window, document: globalThis.document, act: globalThis.IS_REACT_ACT_ENVIRONMENT };
  const dom = createMinimalDom();
  globalThis.window = dom.window; globalThis.document = dom.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let confirms = 0;
  let dismissals = 0;
  let escapedToWindow = 0;
  const onWindowKeyDown = (event) => { if (event.key === "Escape") escapedToWindow += 1; };
  dom.window.addEventListener("keydown", onWindowKeyDown);
  const onConfirm = () => { confirms += 1; };
  const onDismiss = () => { dismissals += 1; };
  const root = createRoot(dom.container);
  const renderConfirmation = async () => {
    await React.act(async () => {
      root.render(React.createElement(AutomaticFileOpenConfirmation, {
        displayPath: "src/file.ts",
        onConfirm,
        onDismiss,
      }));
      await flush();
    });
  };
  try {
    await renderConfirmation();
    const open = elementWithText(dom.container, "BUTTON", "Open file");
    const cancel = elementWithText(dom.container, "BUTTON", "Cancel");
    assert.ok(open); assert.ok(cancel);
    assert.equal(dom.document.activeElement, open);
    assert.match(text(dom.container), /src\/file\.ts/);

    await React.act(async () => dom.document.dispatchEvent({ type: "keydown", key: "Tab", shiftKey: true }));
    assert.equal(dom.document.activeElement, cancel);
    await React.act(async () => dom.document.dispatchEvent({ type: "keydown", key: "Tab", shiftKey: false }));
    assert.equal(dom.document.activeElement, open);
    await React.act(async () => cancel.dispatchEvent({ type: "click", bubbles: true }));
    assert.equal(dismissals, 1);
    await React.act(async () => { root.render(null); await flush(); });

    await renderConfirmation();
    const backdrop = findAll(dom.container, (node) => node.attributes?.class === "automatic-file-confirmation-backdrop")[0];
    assert.ok(backdrop);
    await React.act(async () => backdrop.dispatchEvent({ type: "mousedown", bubbles: true }));
    assert.equal(dismissals, 2);
    await React.act(async () => { root.render(null); await flush(); });

    await renderConfirmation();
    await React.act(async () => elementWithText(dom.container, "BUTTON", "Open file").dispatchEvent({ type: "click", bubbles: true }));
    assert.equal(confirms, 1);
    await React.act(async () => { root.render(null); await flush(); });

    await renderConfirmation();
    await React.act(async () => dom.document.dispatchEvent({ type: "keydown", key: "Escape" }));
    assert.equal(dismissals, 3);
    assert.equal(escapedToWindow, 0, "handled Escape cannot reach global running-agent shortcuts");
    await React.act(async () => root.unmount());
    dom.document.dispatchEvent({ type: "keydown", key: "Escape" });
    assert.equal(dismissals, 3, "unmount removes the document listener");
    assert.equal(escapedToWindow, 1, "unhandled Escape still reaches the window after dialog cleanup");
    dom.window.removeEventListener("keydown", onWindowKeyDown);
  } finally {
    globalThis.window = previous.window; globalThis.document = previous.document; globalThis.IS_REACT_ACT_ENVIRONMENT = previous.act;
  }
});

test("settled generated file actions dispatch one local automatic-open request", async () => {
  const previous = { window: globalThis.window, document: globalThis.document, act: globalThis.IS_REACT_ACT_ENVIRONMENT };
  const dom = createMinimalDom();
  globalThis.window = dom.window; globalThis.document = dom.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const opened = [];
  const root = createRoot(dom.container);
  try {
    await React.act(async () => {
      root.render(React.createElement(MarkdownBody, {
        cwd: "/synthetic/worktree",
        enableAutomaticFileLinks: true,
        onOpenFile: (filePath, options) => opened.push({ filePath, options }),
      }, "Open src/file.ts"));
      await flush();
    });
    const action = elementWithText(dom.container, "BUTTON", "src/file.ts");
    assert.ok(action);
    await React.act(async () => action.dispatchEvent({ type: "click", bubbles: true }));
    assert.equal(opened.length, 1);
    assert.equal(opened[0].filePath, "/synthetic/worktree/src/file.ts");
    assert.equal(opened[0].options.automatic, true);
    assert.equal(opened[0].options.displayPath, "src/file.ts");
    assert.equal(opened[0].options.trigger, action);
    await React.act(async () => root.unmount());
  } finally {
    globalThis.window = previous.window; globalThis.document = previous.document; globalThis.IS_REACT_ACT_ENVIRONMENT = previous.act;
  }
});

test("authored local Markdown links preserve plain and modifier-click behavior", async () => {
  const previous = { window: globalThis.window, document: globalThis.document, act: globalThis.IS_REACT_ACT_ENVIRONMENT };
  const dom = createMinimalDom();
  globalThis.window = dom.window; globalThis.document = dom.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const opened = [];
  const root = createRoot(dom.container);
  try {
    await React.act(async () => {
      root.render(React.createElement(MarkdownBody, {
        cwd: "/synthetic/worktree",
        enableAutomaticFileLinks: true,
        onOpenFile: (filePath, options) => opened.push({ filePath, options }),
      }, "[open](src/file.ts)"));
      await flush();
    });
    const link = elementWithText(dom.container, "A", "open");
    assert.ok(link);
    const modifiedClick = { type: "click", bubbles: true, ctrlKey: true };
    await React.act(async () => link.dispatchEvent(modifiedClick));
    assert.equal(opened.length, 0);
    assert.equal(modifiedClick.defaultPrevented, false);

    const plainClick = { type: "click", bubbles: true };
    await React.act(async () => link.dispatchEvent(plainClick));
    assert.deepEqual(opened, [{ filePath: "/synthetic/worktree/src/file.ts", options: undefined }]);
    assert.equal(plainClick.defaultPrevented, true);
    await React.act(async () => root.unmount());
  } finally {
    globalThis.window = previous.window; globalThis.document = previous.document; globalThis.IS_REACT_ACT_ENVIRONMENT = previous.act;
  }
});

test("viewer source preserves all variants and AppShell mounts only the active tab while CSS close keeps it mounted", async () => {
  const [viewer, shell] = await Promise.all([
    readFile(new URL("./FileViewer.tsx", import.meta.url), "utf8"),
    readFile(new URL("./AppShell.tsx", import.meta.url), "utf8"),
  ]);
  for (const truth of ["isImagePath", "isAudioPath", "isDocumentPreviewPath", "MarkdownFilePreview", "SyntaxHighlighter", "download", "preview", "DOCX_PREVIEW_MAX_BYTES", "sandbox"]) assert.match(viewer, new RegExp(truth));
  assert.doesNotMatch(viewer, /EventSource|type:\s*["']watch["']/);
  assert.equal((viewer.match(/useFileWatch\(/g) ?? []).length, 4, "one common hook call in each mutually exclusive mounted variant");
  assert.match(shell, /activeFileTab\?\.filePath\s*\?\s*\(\s*<FileViewer/);
  assert.match(shell, /right-panel-closed/);
  assert.doesNotMatch(shell, /rightPanelOpen\s*&&\s*activeFileTab\?\.filePath/);
});

test("viewer content uses the independent scale while chrome and opaque renderers keep their owners", async () => {
  const viewer = await readFile(new URL("./FileViewer.tsx", import.meta.url), "utf8");

  assert.equal((viewer.match(/scaledFileViewerFontSize\(/g) ?? []).length, 6);
  assert.match(viewer, /lineNumberStyle=\{\{[\s\S]*?fontSize: scaledFileViewerFontSize\(13\)/);
  assert.match(viewer, /customStyle=\{\{[\s\S]*?fontSize: scaledFileViewerFontSize\(13\)/);
  assert.match(viewer, /fontSize: scaledFileViewerFontSize\(11\)[\s\S]*?unchanged lines/);
  assert.match(viewer, /fontSize: scaledFileViewerFontSize\(11\)[\s\S]*?borderRight: "1px solid var\(--border\)"/);
  assert.doesNotMatch(viewer, /fontSize:\s*(?:11|13)(?:,|\s*})/);

  assert.match(viewer, /fontSize: scaledMenuFontSize\(11\)/, "status and controls remain on Menu");
  assert.match(viewer, /Loading\.\.\.[\s\S]*?scaledMenuFontSize|scaledMenuFontSize\(13\)[\s\S]*?Loading\.\.\./);
  assert.match(viewer, /<iframe[\s\S]*?title="HTML preview"/);
  assert.match(viewer, /title=\{`Preview \$\{getFileName\(filePath\)\}`\}/);
  assert.doesNotMatch(viewer, /\bzoom\b|--pi-file-viewer-font-(?:size|scale)[\s\S]{0,200}<iframe/);
});
