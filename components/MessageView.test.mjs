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
const { MessageView } = await jiti.import("./MessageView.tsx");
const { ProcessDetailsGroup, processGroupContainsEdit, processGroupShouldStartExpanded } = await jiti.import("./ChatWindow.tsx");

function toolCall(toolName, toolCallId, path = "demo.ts") {
  return { type: "toolCall", toolCallId, toolName, input: { path } };
}

function writeCall(toolCallId, { path = "demo.ts", content = "export const value = 1;\n" } = {}) {
  return { type: "toolCall", toolCallId, toolName: "write", input: { path, content } };
}

function toolResult(toolName, toolCallId, options = {}) {
  return {
    role: "toolResult",
    toolName,
    toolCallId,
    content: [{ type: "text", text: options.text ?? "done" }],
    isError: options.isError ?? false,
    ...(options.patch === undefined ? {} : { details: { patch: options.patch } }),
  };
}

function messageElement(calls, results) {
  return React.createElement(MessageView, {
    message: { role: "assistant", content: calls },
    toolResults: new Map(results.map((result) => [result.toolCallId, result])),
  });
}

function renderMessage(calls, results) {
  return renderToStaticMarkup(messageElement(calls, results));
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

  const makeClassList = () => {
    const values = new Set();
    return {
      add(...names) { names.forEach((name) => values.add(name)); },
      remove(...names) { names.forEach((name) => values.delete(name)); },
      contains(name) { return values.has(name); },
    };
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
    classList: makeClassList(),
    disabled: false,
    hidden: false,
    textContent: "",
    focus() { document.activeElement = this; },
    click() { this.dispatchEvent({ type: "click", bubbles: true }); },
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
  document.documentElement = makeElement("html", document);
  document.body = makeElement("body", document);
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
  return element?.getAttribute?.(name) ?? null;
}

function hasClass(element, name) {
  return (attribute(element, "class") ?? "").split(/\s+/).includes(name);
}

function controlledBody(root, button) {
  const id = attribute(button, "aria-controls");
  return findAll(root, (node) => attribute(node, "id") === id)[0] ?? null;
}

async function flushReactUpdate(update) {
  flushSync(update);
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
}

async function mount(element) {
  const previous = { window: globalThis.window, document: globalThis.document };
  const dom = createMinimalDom();
  globalThis.window = dom.window;
  globalThis.document = dom.document;
  const root = createRoot(dom.container);
  await flushReactUpdate(() => root.render(element));
  return {
    dom,
    async render(next) { await flushReactUpdate(() => root.render(next)); },
    async cleanup() {
      await flushReactUpdate(() => root.unmount());
      globalThis.window = previous.window;
      globalThis.document = previous.document;
    },
  };
}

const structuredPatch = `--- a/demo.ts
+++ b/demo.ts
@@ -1,2 +1,2 @@
-const value = "old";
+const value = "new";
 keep();
`;

test("recognized structured edit cards start open with native semantics and remain independent", async () => {
  const calls = [toolCall("edit", "edit-one"), toolCall("workspace.edit", "edit-two", "second.ts")];
  const results = [
    toolResult("edit", "edit-one", { patch: structuredPatch }),
    toolResult("workspace.edit", "edit-two", { patch: structuredPatch.replaceAll("demo.ts", "second.ts") }),
  ];
  const mounted = await mount(messageElement(calls, results));

  try {
    const buttons = findAll(mounted.dom.container, (node) => node.tagName === "BUTTON" && hasClass(node, "tool-call-disclosure"));
    assert.equal(buttons.length, 2);
    for (const button of buttons) {
      assert.equal(attribute(button, "type"), "button");
      assert.equal(attribute(button, "aria-expanded"), "true");
      assert.match(attribute(button, "aria-label"), /^Collapse /);
      const body = controlledBody(mounted.dom.container, button);
      assert.ok(body);
      assert.equal(body.hasAttribute("hidden"), false);
      assert.match(elementText(body), /const value = "old";/);
      assert.match(elementText(body), /const value = "new";/);
    }

    const firstBody = controlledBody(mounted.dom.container, buttons[0]);
    buttons[0].focus();
    assert.strictEqual(mounted.dom.document.activeElement, buttons[0]);
    await flushReactUpdate(() => buttons[0].click());
    const updatedButtons = findAll(mounted.dom.container, (node) => node.tagName === "BUTTON" && hasClass(node, "tool-call-disclosure"));
    assert.equal(attribute(updatedButtons[0], "aria-expanded"), "false");
    assert.equal(attribute(updatedButtons[0], "aria-label"), "Expand edit tool details: demo.ts, 1 addition and 1 deletion");
    assert.strictEqual(controlledBody(mounted.dom.container, updatedButtons[0]), firstBody, "the aria-controls target remains mounted");
    assert.equal(firstBody.hasAttribute("hidden"), true);
    assert.equal(elementText(firstBody), "", "collapse releases expensive result children");
    assert.equal(attribute(updatedButtons[1], "aria-expanded"), "true", "the second edit keeps independent state");

    await flushReactUpdate(() => updatedButtons[0].click());
    const reopened = findAll(mounted.dom.container, (node) => node.tagName === "BUTTON" && hasClass(node, "tool-call-disclosure"))[0];
    assert.equal(attribute(reopened, "aria-expanded"), "true");
    assert.equal(attribute(reopened, "aria-label"), "Collapse edit tool details: demo.ts, 1 addition and 1 deletion");
    assert.equal(controlledBody(mounted.dom.container, reopened).hasAttribute("hidden"), false);
    assert.match(elementText(controlledBody(mounted.dom.container, reopened)), /const value = "new";/);
  } finally {
    await mounted.cleanup();
  }
});

test("plain success and failed edit results start open and remain understandable", () => {
  const html = renderMessage(
    [toolCall("edit_file", "plain"), toolCall("replace_editor", "error")],
    [
      toolResult("edit_file", "plain", { text: "Replaced one block." }),
      toolResult("replace_editor", "error", { text: "Could not find the exact text.", isError: true }),
    ],
  );

  assert.equal((html.match(/aria-expanded="true"/g) ?? []).length, 2);
  assert.match(html, /Replaced one block\./);
  assert.match(html, /Could not find the exact text\./);
  assert.match(html, /tool-result-text is-natural-height/);
  assert.match(html, /tool-result-text is-error is-natural-height/);
});

test("pending writes hide arguments, open once on completion, and respect later manual collapse", async () => {
  const call = writeCall("write-live", {
    path: "src/live.ts",
    content: 'const message = "completed";\n',
  });
  const success = toolResult("write", "write-live", { text: "Successfully wrote 29 bytes to src/live.ts" });
  const mounted = await mount(messageElement([call], []));

  try {
    let button = findAll(mounted.dom.container, (node) => node.tagName === "BUTTON" && hasClass(node, "tool-call-disclosure"))[0];
    let body = controlledBody(mounted.dom.container, button);
    assert.equal(attribute(button, "aria-expanded"), "false");
    assert.equal(body.hasAttribute("hidden"), true);
    assert.equal(elementText(body), "", "pending write arguments are not mounted as raw JSON or code");
    assert.equal(findAll(body, (node) => hasClass(node, "tool-call-input")).length, 0);
    assert.equal(findAll(body, (node) => hasClass(node, "write-content")).length, 0);

    await mounted.render(messageElement([call], [success]));
    button = findAll(mounted.dom.container, (node) => node.tagName === "BUTTON" && hasClass(node, "tool-call-disclosure"))[0];
    body = controlledBody(mounted.dom.container, button);
    assert.equal(attribute(button, "aria-expanded"), "true", "the first matching result opens an untouched live card");
    assert.match(elementText(body), /Written contentsrc\/live\.ts/);
    assert.match(elementText(body), /const message = "completed";/);
    assert.match(elementText(body), /Successfully wrote 29 bytes/);
    assert.equal(findAll(body, (node) => hasClass(node, "tool-call-input")).length, 0, "valid writes suppress raw JSON");

    await flushReactUpdate(() => button.click());
    button = findAll(mounted.dom.container, (node) => node.tagName === "BUTTON" && hasClass(node, "tool-call-disclosure"))[0];
    body = controlledBody(mounted.dom.container, button);
    assert.equal(attribute(button, "aria-expanded"), "false");
    assert.equal(elementText(body), "", "collapse releases the whole-file renderer");

    const updated = toolResult("write", "write-live", { text: "Updated result identity" });
    await mounted.render(messageElement([call], [updated]));
    button = findAll(mounted.dom.container, (node) => node.tagName === "BUTTON" && hasClass(node, "tool-call-disclosure"))[0];
    assert.equal(attribute(button, "aria-expanded"), "false", "later result identities never reopen a touched card");

    await flushReactUpdate(() => button.click());
    button = findAll(mounted.dom.container, (node) => node.tagName === "BUTTON" && hasClass(node, "tool-call-disclosure"))[0];
    assert.equal(attribute(button, "aria-expanded"), "true");
    assert.match(elementText(controlledBody(mounted.dom.container, button)), /Updated result identity/);
  } finally {
    await mounted.cleanup();
  }
});

test("pre-completion write disclosure choices stay authoritative for success and failure", async () => {
  const calls = [
    writeCall("manual-open", { content: "open();" }),
    writeCall("manual-closed", { content: "closed();" }),
  ];
  const mounted = await mount(messageElement(calls, []));

  try {
    let buttons = findAll(mounted.dom.container, (node) => node.tagName === "BUTTON" && hasClass(node, "tool-call-disclosure"));
    await flushReactUpdate(() => buttons[0].click());
    buttons = findAll(mounted.dom.container, (node) => node.tagName === "BUTTON" && hasClass(node, "tool-call-disclosure"));
    await flushReactUpdate(() => buttons[1].click());
    buttons = findAll(mounted.dom.container, (node) => node.tagName === "BUTTON" && hasClass(node, "tool-call-disclosure"));
    await flushReactUpdate(() => buttons[1].click());

    const results = [
      toolResult("write", "manual-open", { text: "done" }),
      toolResult("write", "manual-closed", { text: "permission denied", isError: true }),
    ];
    await mounted.render(messageElement(calls, results));
    buttons = findAll(mounted.dom.container, (node) => node.tagName === "BUTTON" && hasClass(node, "tool-call-disclosure"));
    assert.deepEqual(buttons.map((button) => attribute(button, "aria-expanded")), ["true", "false"]);
    assert.match(elementText(controlledBody(mounted.dom.container, buttons[0])), /Written content/);
    assert.equal(elementText(controlledBody(mounted.dom.container, buttons[1])), "");

    await flushReactUpdate(() => buttons[1].click());
    buttons = findAll(mounted.dom.container, (node) => node.tagName === "BUTTON" && hasClass(node, "tool-call-disclosure"));
    const failedBody = controlledBody(mounted.dom.container, buttons[1]);
    assert.match(elementText(failedBody), /Attempted content/);
    assert.match(elementText(failedBody), /permission denied/);
  } finally {
    await mounted.cleanup();
  }
});

test("completed write views preserve content, path, status, and decorative line numbers", () => {
  const content = '<script data-x="1">alert("owned")</script>\n\tconst long = "' + "x".repeat(4_100) + '";\n';
  const successHtml = renderMessage(
    [writeCall("write-fidelity", { path: "src/hostile.ts", content })],
    [toolResult("write", "write-fidelity", { text: "Successfully wrote the requested content." })],
  );

  assert.match(successHtml, /aria-expanded="true"/);
  assert.match(successHtml, /class="write-content" data-file-path="src\/hostile\.ts" data-language="typescript" data-empty="false"/);
  assert.match(successHtml, /Written content/);
  assert.match(successHtml, /Successfully wrote the requested content\./);
  assert.match(successHtml, /data-renderer="plaintext"/, "an over-budget source line skips syntax work without losing content");
  assert.equal((successHtml.match(/class="write-code-line-number" aria-hidden="true"/g) ?? []).length, 3);
  assert.match(successHtml, /\tconst long/);
  assert.match(successHtml, new RegExp(`x{${4_100}}`));
  assert.doesNotMatch(successHtml, /<script[ >]/i);
  assert.match(successHtml, /&lt;script data-x=&quot;1&quot;&gt;alert/);
  assert.doesNotMatch(successHtml, /tool-call-input/);

  const failedHtml = renderMessage(
    [writeCall("write-failed", { path: "src/failure.ts", content: "attempt();" })],
    [toolResult("write", "write-failed", { text: "Permission denied.", isError: true })],
  );
  assert.match(failedHtml, /Attempted content/);
  assert.doesNotMatch(failedHtml, /Written content/);
  assert.match(failedHtml, /Permission denied\./);
  assert.match(failedHtml, /tool-result-text is-error is-natural-height/);
});

test("write code rows retain exact hostile text, tabs, and a final newline", async () => {
  const content = '<script data-x="1">alert("owned")</script>\n\tconst value = "snow: 雪";\n';
  const call = writeCall("write-exact", { path: "src/exact.ts", content });
  const mounted = await mount(messageElement([call], [toolResult("write", "write-exact")]));

  try {
    const codeLines = findAll(mounted.dom.container, (node) => hasClass(node, "write-code-text"));
    const lineNumbers = findAll(mounted.dom.container, (node) => hasClass(node, "write-code-line-number"));
    assert.deepEqual(codeLines.map(elementText), content.split("\n"));
    assert.deepEqual(lineNumbers.map(elementText), ["1", "2", "3"]);
    assert.ok(lineNumbers.every((lineNumber) => attribute(lineNumber, "aria-hidden") === "true"));
    assert.equal(findAll(mounted.dom.container, (node) => node.tagName === "SCRIPT").length, 0);
  } finally {
    await mounted.cleanup();
  }
});

test("empty, syntax-highlighted, unsupported, and oversized writes keep complete line-numbered text", () => {
  const emptyHtml = renderMessage(
    [writeCall("empty", { path: "empty.ts", content: "" })],
    [toolResult("write", "empty")],
  );
  assert.match(emptyHtml, /data-empty="true"/);
  assert.match(emptyHtml, /Empty file/);
  assert.match(emptyHtml, /\(empty file\)/);
  assert.equal((emptyHtml.match(/class="write-code-line-number"/g) ?? []).length, 1);

  const syntaxContent = "/* open\n * middle\n */\nconst value = 1;";
  const syntaxHtml = renderMessage(
    [writeCall("syntax", { path: "syntax.ts", content: syntaxContent })],
    [toolResult("write", "syntax")],
  );
  assert.match(syntaxHtml, /data-renderer="syntax"/);
  assert.equal((syntaxHtml.match(/class="write-code-line-number"/g) ?? []).length, 4);
  for (const text of ["open", "middle", "const", "value"]) assert.match(syntaxHtml, new RegExp(text));

  const unsupportedContent = "first\n\tsecond\nthird";
  const unsupportedHtml = renderMessage(
    [writeCall("unsupported", { path: "source.unknown", content: unsupportedContent })],
    [toolResult("write", "unsupported")],
  );
  assert.match(unsupportedHtml, /data-language="text"/);
  assert.match(unsupportedHtml, /data-renderer="plaintext"/);
  assert.equal((unsupportedHtml.match(/class="write-code-line-number"/g) ?? []).length, 3);
  assert.match(unsupportedHtml, /first/);
  assert.match(unsupportedHtml, /\tsecond/);
  assert.match(unsupportedHtml, /third/);

  const oversizedContent = `first\n${"z".repeat(120_001)}\nlast`;
  const oversizedHtml = renderMessage(
    [writeCall("oversized", { path: "oversized.ts", content: oversizedContent })],
    [toolResult("write", "oversized")],
  );
  assert.match(oversizedHtml, /data-renderer="plaintext"/);
  assert.equal((oversizedHtml.match(/class="write-code-line-number"/g) ?? []).length, 3);
  assert.match(oversizedHtml, /first/);
  assert.match(oversizedHtml, new RegExp(`z{${120_001}}`));
  assert.match(oversizedHtml, /last/);
});

test("malformed completed writes use ordinary JSON and result fallback", () => {
  const malformed = { type: "toolCall", toolCallId: "malformed-write", toolName: "write", input: { path: "missing-content.ts" } };
  const html = renderMessage([malformed], [toolResult("write", "malformed-write", { text: "Invalid write input." })]);

  assert.match(html, /aria-expanded="true"/);
  assert.match(html, /tool-call-input/);
  assert.match(html, /&quot;path&quot;: &quot;missing-content\.ts&quot;/);
  assert.match(html, /Invalid write input\./);
  assert.doesNotMatch(html, /write-content/);
});

test("non-edit and similar unrecognized tools stay collapsed and toggle independently", async () => {
  const calls = [toolCall("bash", "bash"), toolCall("editor", "editor"), toolCall("write_file", "write-near")];
  const results = [
    toolResult("bash", "bash", { text: "bash output" }),
    toolResult("editor", "editor", { text: "editor output" }),
    toolResult("write_file", "write-near", { text: "near-name output" }),
  ];
  const mounted = await mount(messageElement(calls, results));

  try {
    let buttons = findAll(mounted.dom.container, (node) => node.tagName === "BUTTON" && hasClass(node, "tool-call-disclosure"));
    assert.deepEqual(buttons.map((button) => attribute(button, "aria-expanded")), ["false", "false", "false"]);
    for (const button of buttons) {
      const body = controlledBody(mounted.dom.container, button);
      assert.equal(body.hasAttribute("hidden"), true);
      assert.equal(elementText(body), "", "collapsed non-edit tools defer their result DOM");
    }

    await flushReactUpdate(() => buttons[1].click());
    buttons = findAll(mounted.dom.container, (node) => node.tagName === "BUTTON" && hasClass(node, "tool-call-disclosure"));
    assert.deepEqual(buttons.map((button) => attribute(button, "aria-expanded")), ["false", "true", "false"]);
    assert.match(elementText(controlledBody(mounted.dom.container, buttons[1])), /editor output/);
    assert.equal(findAll(mounted.dom.container, (node) => hasClass(node, "write-content")).length, 0);
  } finally {
    await mounted.cleanup();
  }
});

test("patch-shaped details do not replace an unrelated tool's established preview", async () => {
  const call = { type: "toolCall", toolCallId: "bash-patch", toolName: "bash", input: { command: "printf retained-preview" } };
  const result = toolResult("bash", "bash-patch", { patch: structuredPatch });
  const mounted = await mount(messageElement([call], [result]));

  try {
    let button = findAll(mounted.dom.container, (node) => node.tagName === "BUTTON" && hasClass(node, "tool-call-disclosure"))[0];
    assert.match(attribute(button, "aria-label"), /printf retained-preview/);
    await flushReactUpdate(() => button.click());
    button = findAll(mounted.dom.container, (node) => node.tagName === "BUTTON" && hasClass(node, "tool-call-disclosure"))[0];
    assert.match(attribute(button, "aria-label"), /printf retained-preview/);
    assert.doesNotMatch(attribute(button, "aria-label"), /demo\.ts/);
    assert.match(elementText(controlledBody(mounted.dom.container, button)), /const value = "new";/);
  } finally {
    await mounted.cleanup();
  }
});

test("completed Process details classifies only its exact blocks, defaults edit turns open, and remains collapsible", async () => {
  const messages = [
    { role: "assistant", content: [toolCall("edit", "outside")] },
    { role: "assistant", content: [toolCall("bash", "inside")] },
  ];
  assert.equal(processGroupContainsEdit(messages, [1], []), false, "an edit outside the grouped indices does not open this group");
  assert.equal(processGroupContainsEdit(messages, [0], []), true, "a grouped edit opens the group");
  assert.equal(processGroupContainsEdit(messages, [1], [toolCall("workspace.edit", "final")]), true, "an edit in the final grouped blocks opens the group");

  const groupedWrites = [
    { role: "assistant", content: [writeCall("outside-write")] },
    { role: "assistant", content: [writeCall("inside-write"), toolCall("workspace.write", "near-write")] },
  ];
  assert.equal(processGroupShouldStartExpanded(groupedWrites, [1], [], new Set()), false, "pending writes do not open a settled group");
  assert.equal(processGroupShouldStartExpanded(groupedWrites, [1], [], new Set(["orphan"])), false, "an orphan result cannot open the group");
  assert.equal(processGroupShouldStartExpanded(groupedWrites, [1], [], new Set(["outside-write"])), false, "an outside write cannot open this exact group");
  assert.equal(processGroupShouldStartExpanded(groupedWrites, [1], [], new Set(["near-write"])), false, "a completed near-name tool cannot open the group");
  assert.equal(processGroupShouldStartExpanded(groupedWrites, [1], [], new Set(["inside-write"])), true, "a matching completed grouped write opens the group");
  assert.equal(processGroupShouldStartExpanded(groupedWrites, [], [writeCall("final-write")], new Set(["final-write"])), true, "a matching completed final block opens the group");
  assert.equal(processGroupShouldStartExpanded(messages, [0], [], new Set()), true, "edit behavior stays result-independent");

  const openGroup = React.createElement(ProcessDetailsGroup, {
    messageCount: 2,
    toolCallCount: 1,
    defaultExpanded: true,
  }, React.createElement("span", null, "edit process body"));
  const mounted = await mount(openGroup);

  try {
    let button = findAll(mounted.dom.container, (node) => node.tagName === "BUTTON" && hasClass(node, "process-details-disclosure"))[0];
    assert.equal(attribute(button, "aria-expanded"), "true");
    assert.equal(attribute(button, "aria-label"), "Collapse Process details, 2 messages, 1 tool call");
    assert.match(elementText(controlledBody(mounted.dom.container, button)), /edit process body/);

    await flushReactUpdate(() => button.click());
    button = findAll(mounted.dom.container, (node) => node.tagName === "BUTTON" && hasClass(node, "process-details-disclosure"))[0];
    assert.equal(attribute(button, "aria-expanded"), "false");
    assert.equal(attribute(button, "aria-label"), "Expand Process details, 2 messages, 1 tool call");
    const collapsedBody = controlledBody(mounted.dom.container, button);
    assert.ok(collapsedBody, "the collapsed disclosure keeps a valid aria-controls target");
    assert.equal(collapsedBody.hasAttribute("hidden"), true);
    assert.equal(elementText(collapsedBody), "");

    await flushReactUpdate(() => button.click());
    button = findAll(mounted.dom.container, (node) => node.tagName === "BUTTON" && hasClass(node, "process-details-disclosure"))[0];
    assert.equal(attribute(button, "aria-expanded"), "true");
  } finally {
    await mounted.cleanup();
  }

  const closedHtml = renderToStaticMarkup(React.createElement(ProcessDetailsGroup, {
    messageCount: 1,
    toolCallCount: 1,
  }, React.createElement("span", null, "ordinary process body")));
  assert.match(closedHtml, /aria-expanded="false"/);
  assert.doesNotMatch(closedHtml, /ordinary process body/);
});

test("completed write Process details and its card remain independently collapsible", async () => {
  const call = writeCall("grouped-write", { path: "grouped.ts", content: "grouped();" });
  const result = toolResult("write", "grouped-write", { text: "done" });
  const group = React.createElement(ProcessDetailsGroup, {
    messageCount: 1,
    toolCallCount: 1,
    defaultExpanded: true,
  }, messageElement([call], [result]));
  const mounted = await mount(group);

  try {
    let groupButton = findAll(mounted.dom.container, (node) => node.tagName === "BUTTON" && hasClass(node, "process-details-disclosure"))[0];
    let toolButton = findAll(mounted.dom.container, (node) => node.tagName === "BUTTON" && hasClass(node, "tool-call-disclosure"))[0];
    assert.equal(attribute(groupButton, "aria-expanded"), "true");
    assert.equal(attribute(toolButton, "aria-expanded"), "true");

    await flushReactUpdate(() => toolButton.click());
    groupButton = findAll(mounted.dom.container, (node) => node.tagName === "BUTTON" && hasClass(node, "process-details-disclosure"))[0];
    toolButton = findAll(mounted.dom.container, (node) => node.tagName === "BUTTON" && hasClass(node, "tool-call-disclosure"))[0];
    assert.equal(attribute(groupButton, "aria-expanded"), "true", "collapsing the write does not collapse Process details");
    assert.equal(attribute(toolButton, "aria-expanded"), "false");

    await flushReactUpdate(() => groupButton.click());
    groupButton = findAll(mounted.dom.container, (node) => node.tagName === "BUTTON" && hasClass(node, "process-details-disclosure"))[0];
    assert.equal(attribute(groupButton, "aria-expanded"), "false");
    assert.equal(findAll(mounted.dom.container, (node) => hasClass(node, "tool-call-disclosure")).length, 0);

    await flushReactUpdate(() => groupButton.click());
    groupButton = findAll(mounted.dom.container, (node) => node.tagName === "BUTTON" && hasClass(node, "process-details-disclosure"))[0];
    toolButton = findAll(mounted.dom.container, (node) => node.tagName === "BUTTON" && hasClass(node, "tool-call-disclosure"))[0];
    assert.equal(attribute(groupButton, "aria-expanded"), "true");
    assert.equal(attribute(toolButton, "aria-expanded"), "true", "a remounted completed write uses its historical default");
  } finally {
    await mounted.cleanup();
  }
});

test("structured patches render vertical review hierarchy, stats, truthful gutters, and conservative emphasis", () => {
  const multiPatch = `--- a/first.ts
+++ b/first.ts
@@ -1 +1 @@
-const first = "old";
+const first = "new";
--- a/second.unknown
+++ b/second.unknown
@@ -4,2 +4,1 @@
-remove one
-remove two
+add one
`;
  const html = renderMessage(
    [toolCall("edit", "multi")],
    [toolResult("edit", "multi", { patch: multiPatch })],
  );

  assert.match(html, /data-layout="unified"/);
  assert.match(html, /2 changed files/);
  assert.match(html, /data-file-path="first\.ts" data-language="typescript"/);
  assert.match(html, /data-file-path="second\.unknown" data-language="text"/);
  assert.match(html, /data-renderer="syntax"/);
  assert.match(html, /data-renderer="plaintext"/);
  assert.match(html, /aria-label="2 additions and 3 deletions"/);
  assert.ok(html.indexOf('data-row-type="removed"') < html.indexOf('data-row-type="added"'));
  assert.match(html, /<span class="edit-diff-marker">−<\/span>/);
  assert.match(html, /<span class="edit-diff-marker">\+<\/span>/);
  assert.match(html, /<mark class="edit-diff-intraline">old<\/mark>/);
  const secondFileStart = html.indexOf('data-file-path="second.unknown"');
  assert.doesNotMatch(html.slice(secondFileStart), /edit-diff-intraline/, "unequal replacement run receives only whole-row cues");
  assert.doesNotMatch(html, /grid-template-columns|minmax\(0, 1fr\) minmax\(0, 1fr\)/, "layout is not serialized as split columns");
});

test("single-file paths are not duplicated and context omissions keep their exact count", () => {
  const patch = `--- a/single.ts
+++ b/single.ts
@@ -1,9 +1,9 @@
-old-one
+new-one
 context-2
 context-3
 context-4
 context-5
 context-6
 context-7
 context-8
-old-nine
+new-nine
`;
  const html = renderMessage([toolCall("edit", "single")], [toolResult("edit", "single", { patch })]);

  assert.match(html, /<span class="tool-call-preview"[^>]*>single\.ts<\/span>/);
  assert.doesNotMatch(html, /edit-diff-file-header/, "the single path stays in the disclosure header only");
  assert.match(html, /1 unchanged line omitted/);
  assert.match(html, /data-row-type="omission"/);
});

test("syntax decoration uses separate full old and new hunk projections", () => {
  const patch = `--- a/commented.ts
+++ b/commented.ts
@@ -1,9 +1,9 @@
 /*
 context-two
 context-three
 context-four
-old inside comment
+new inside comment
 context-six
 context-seven
 context-eight
 context-nine
`;
  const html = renderMessage([toolCall("edit", "commented", "commented.ts")], [toolResult("edit", "commented", { patch })]);

  assert.match(html, /data-renderer="syntax"/);
  assert.match(html, /data-row-type="removed" data-syntax-projection="old"/);
  assert.match(html, /data-row-type="added" data-syntax-projection="new"/);
  assert.match(html, /1 unchanged line omitted/);
  const removedStart = html.indexOf('data-row-type="removed"');
  const addedStart = html.indexOf('data-row-type="added"', removedStart);
  const removedMarkup = html.slice(removedStart, addedStart);
  assert.match(removedMarkup, /color:#008000/, "the omitted comment opener participates in the old-side syntax state");
  assert.match(removedMarkup, /old/);
  assert.match(html.slice(addedStart), /new/);
});

test("many small hunks use one exact plaintext fallback instead of an unbounded structured tree", () => {
  const hunkCount = 201;
  let patch = "--- a/many.ts\n+++ b/many.ts\n";
  for (let index = 1; index <= hunkCount; index++) {
    patch += `@@ -${index} +${index} @@\n-old-${index}\n+new-${index}\n`;
  }
  const html = renderMessage([toolCall("edit", "many", "many.ts")], [toolResult("edit", "many", { patch })]);

  assert.match(html, /edit-patch-fallback/);
  assert.doesNotMatch(html, /edit-diff-hunk/);
  assert.match(html, /@@ -201 \+201 @@/);
  assert.match(html, /-old-201/);
  assert.match(html, /\+new-201/);
});

test("hostile and oversized code remains inert, exact, soft-wrapped plaintext", () => {
  const hostile = '<script data-x="1">alert("owned")</script>';
  const hostilePatch = `--- a/demo.html
+++ b/demo.html
@@ -1 +1 @@
-<div>safe</div>
+${hostile}
`;
  const hostileHtml = renderMessage([toolCall("edit", "hostile")], [toolResult("edit", "hostile", { patch: hostilePatch })]);
  assert.doesNotMatch(hostileHtml, /<script[ >]/i);
  assert.match(hostileHtml, /&lt;/);
  assert.match(hostileHtml, /alert/);

  const longOld = `const value = "${"a".repeat(4_100)}";`;
  const longNew = `const value = "${"b".repeat(4_100)}";`;
  const largePatch = `--- a/large.ts
+++ b/large.ts
@@ -1 +1 @@
-${longOld}
+${longNew}
`;
  const largeHtml = renderMessage([toolCall("edit", "large")], [toolResult("edit", "large", { patch: largePatch })]);
  assert.match(largeHtml, /data-language="typescript"/);
  assert.match(largeHtml, /data-renderer="plaintext"/);
  assert.doesNotMatch(largeHtml, /edit-diff-intraline/);
  assert.match(largeHtml, new RegExp(`a{${4_100}}`));
  assert.match(largeHtml, new RegExp(`b{${4_100}}`));
});

test("malformed structured detail falls back to immutable readable plaintext", () => {
  const malformed = "not a unified patch\n+looks added\n<script>still text</script>";
  const html = renderMessage([toolCall("edit", "malformed")], [toolResult("edit", "malformed", { patch: malformed })]);

  assert.match(html, /edit-patch-fallback/);
  assert.match(html, /Patch shown as plain text/);
  assert.match(html, /\+looks added/);
  assert.doesNotMatch(html, /data-row-type="added"/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;still text&lt;\/script&gt;/);
});

test("write and edit CSS guarantee visible focus, natural height, neutral gutters, and soft wrapping", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const editStart = css.indexOf("/* Transcript tool disclosures, whole-file writes, and change-focused edit review cards. */");
  const editEnd = css.indexOf(".mermaid-block {", editStart);
  const editCss = css.slice(editStart, editEnd);
  const writeCss = editCss.slice(editCss.indexOf(".write-content"), editCss.indexOf(".edit-diff-stats"));
  const patchCss = editCss.slice(editCss.indexOf(".edit-patch-result"));

  assert.match(editCss, /\.tool-call-disclosure:focus-visible\s*\{[\s\S]*?outline: 2px solid var\(--accent\)/);
  assert.match(editCss, /\.process-details-disclosure:focus-visible\s*\{[\s\S]*?outline: 2px solid var\(--accent\)/);
  assert.match(editCss, /\.edit-diff-code\s*\{[\s\S]*?white-space: pre-wrap;[\s\S]*?overflow-wrap: anywhere;/);
  assert.match(editCss, /\.edit-diff-row\s*\{[\s\S]*?grid-template-columns:[^;]*minmax\(0, 1fr\)/);
  assert.match(writeCss, /\.write-code-text\s*\{[\s\S]*?white-space: pre-wrap;[\s\S]*?overflow-wrap: anywhere;/);
  assert.match(writeCss, /\.write-code-line-number\s*\{[\s\S]*?user-select: none;/);
  assert.doesNotMatch(writeCss, /overflow-[xy]:\s*auto|max-height:\s*\d|diff-(?:add|remove)/, "whole-file writes use natural height and neutral code rows");
  assert.doesNotMatch(patchCss, /overflow-[xy]:\s*auto|max-height:\s*\d/, "patches use the transcript scroll and natural height");
  assert.doesNotMatch(patchCss, /grid-template-columns:\s*minmax\(0, 1fr\)\s+minmax\(0, 1fr\)/, "no split-view rule exists");
});
