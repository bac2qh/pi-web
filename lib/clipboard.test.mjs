import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { copyText } = await jiti.import("./clipboard.ts");

async function withGlobals(navigatorValue, documentValue, run) {
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "navigator", { configurable: true, writable: true, value: navigatorValue });
  Object.defineProperty(globalThis, "document", { configurable: true, writable: true, value: documentValue });
  try {
    return await run();
  } finally {
    if (navigatorDescriptor) Object.defineProperty(globalThis, "navigator", navigatorDescriptor);
    else delete globalThis.navigator;
    if (documentDescriptor) Object.defineProperty(globalThis, "document", documentDescriptor);
    else delete globalThis.document;
  }
}

function fallbackDocument(execResult) {
  const children = [];
  const textarea = {
    value: "",
    style: {},
    selected: false,
    removed: false,
    select() { this.selected = true; },
    remove() {
      this.removed = true;
      const index = children.indexOf(this);
      if (index >= 0) children.splice(index, 1);
    },
  };
  return {
    textarea,
    children,
    document: {
      body: { appendChild(node) { children.push(node); } },
      createElement(tag) {
        assert.equal(tag, "textarea");
        return textarea;
      },
      execCommand() {
        if (execResult instanceof Error) throw execResult;
        return execResult;
      },
    },
  };
}

test("modern Clipboard API success and rejection reach the caller unchanged", async () => {
  const rejection = new Error("permission denied");
  const copied = [];
  await withGlobals({ clipboard: { writeText: async (text) => { copied.push(text); } } }, {}, async () => {
    await copyText("session-id");
  });
  assert.deepEqual(copied, ["session-id"]);

  await withGlobals({ clipboard: { writeText: () => Promise.reject(rejection) } }, {}, async () => {
    await assert.rejects(copyText("session-id"), (error) => error === rejection);
  });
});

test("legacy fallback resolves only on true and always removes its textarea", async () => {
  for (const [result, succeeds] of [[true, true], [false, false], [new Error("copy failed"), false]]) {
    const fixture = fallbackDocument(result);
    await withGlobals({}, fixture.document, async () => {
      if (succeeds) await copyText("exact-id");
      else await assert.rejects(copyText("exact-id"));
    });
    assert.equal(fixture.textarea.value, "exact-id");
    assert.equal(fixture.textarea.selected, true);
    assert.equal(fixture.textarea.removed, true);
    assert.deepEqual(fixture.children, []);
  }
});

test("legacy setup failure still removes an appended textarea", async () => {
  const fixture = fallbackDocument(true);
  fixture.textarea.select = () => { throw new Error("selection failed"); };
  await withGlobals({}, fixture.document, async () => {
    await assert.rejects(copyText("exact-id"), /selection failed/u);
  });
  assert.equal(fixture.textarea.removed, true);
  assert.deepEqual(fixture.children, []);
});
