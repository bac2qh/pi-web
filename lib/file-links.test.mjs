import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });

async function loadSubject() {
  return jiti.import("./file-links.ts");
}

test("resolves absolute markdown file links and strips line suffixes", async () => {
  const { resolveLocalFileHref } = await loadSubject();

  assert.equal(
    resolveLocalFileHref(
      "/home/me/project/components/MarkdownBody.tsx:36",
      "/home/me/project",
    ),
    "/home/me/project/components/MarkdownBody.tsx",
  );
});

test("resolves absolute file links outside cwd", async () => {
  const { resolveLocalFileHref } = await loadSubject();

  assert.equal(
    resolveLocalFileHref(
      "/home/me/.codex/config.toml:12",
      "/home/me/project",
    ),
    "/home/me/.codex/config.toml",
  );
});

test("resolves relative markdown file links against cwd", async () => {
  const { resolveLocalFileHref } = await loadSubject();

  assert.equal(
    resolveLocalFileHref("components/AppShell.tsx#L42", "/home/me/project"),
    "/home/me/project/components/AppShell.tsx",
  );
});

test("does not let relative links escape cwd", async () => {
  const { resolveLocalFileHref } = await loadSubject();

  assert.equal(
    resolveLocalFileHref("../outside.md", "/home/me/project"),
    null,
  );
});

test("resolves preview links from the file directory within the project root", async () => {
  const { resolveLocalFileHref } = await loadSubject();

  assert.equal(
    resolveLocalFileHref("../file.js", "/home/me/project/docs/nested", "/home/me/project"),
    "/home/me/project/docs/file.js",
  );
  assert.equal(
    resolveLocalFileHref("../../../outside.js", "/home/me/project/docs/nested", "/home/me/project"),
    null,
  );
});

test("does not treat app or external URLs as file links", async () => {
  const { resolveLocalFileHref } = await loadSubject();

  assert.equal(resolveLocalFileHref("/api/files/home/me/project/a.ts", "/home/me/project"), null);
  assert.equal(resolveLocalFileHref("https://example.com/a.ts", "/home/me/project"), null);
  assert.equal(resolveLocalFileHref("ftp://example.com/a.ts", "/home/me/project"), null);
  assert.equal(resolveLocalFileHref("//example.com/a.ts", "/home/me/project"), null);
});

test("resolves Windows file URLs without a synthetic leading slash", async () => {
  const { resolveLocalFileHref } = await loadSubject();

  assert.equal(
    resolveLocalFileHref("file:///C:/Users/me/project/file.txt:10", "C:/Users/me/project"),
    "C:/Users/me/project/file.txt",
  );
});

test("resolves UNC file URLs and backslash UNC paths", async () => {
  const { resolveLocalFileHref } = await loadSubject();

  assert.equal(
    resolveLocalFileHref("file://server/share/project/file.txt", "/home/me/project"),
    "//server/share/project/file.txt",
  );
  assert.equal(
    resolveLocalFileHref("\\\\server\\share\\project\\file.txt", "/home/me/project"),
    "//server/share/project/file.txt",
  );
});

test("resolves automatic paths only inside the exact workspace", async () => {
  const { resolveAutomaticFilePath } = await loadSubject();
  const workspace = "/repo/.agents/worktrees/task";

  assert.equal(resolveAutomaticFilePath("components/AppShell.tsx:42:7", workspace), `${workspace}/components/AppShell.tsx`);
  assert.equal(resolveAutomaticFilePath("AppShell.tsx:42", workspace), `${workspace}/AppShell.tsx`);
  assert.equal(resolveAutomaticFilePath("Dockerfile", workspace), `${workspace}/Dockerfile`);
  assert.equal(resolveAutomaticFilePath(`${workspace}/README.md`, workspace), `${workspace}/README.md`);
  assert.equal(resolveAutomaticFilePath("../task-sibling/file.ts", workspace), null);
  assert.equal(resolveAutomaticFilePath("/repo/components/AppShell.tsx", workspace), null);
  assert.equal(resolveAutomaticFilePath("/repo/.agents/worktrees/task-sibling/file.ts", workspace), null);
  assert.equal(resolveAutomaticFilePath("report.pdf", workspace), null);
  assert.equal(resolveAutomaticFilePath("Dockerfile.pdf", workspace), null);
  assert.equal(resolveAutomaticFilePath("Dockerfile.exe", workspace), null);
  assert.equal(resolveAutomaticFilePath("Dockerfile.msi", workspace), null);
  assert.equal(resolveAutomaticFilePath(".env.png", workspace), null);
  assert.equal(resolveAutomaticFilePath(".env.zip", workspace), null);
  assert.equal(resolveAutomaticFilePath(".env.com", workspace), null);
  assert.equal(resolveAutomaticFilePath("payload.unknown", workspace), null);
  assert.equal(resolveAutomaticFilePath("arbitrary-extensionless", workspace), null);
});

test("requires delimiters for whitespace and rejects URL-like candidates", async () => {
  const { resolveAutomaticFilePath } = await loadSubject();
  const workspace = "/home/me/project";

  assert.equal(resolveAutomaticFilePath("docs/My File.md", workspace), null);
  assert.equal(
    resolveAutomaticFilePath("docs/My File.md", workspace, { allowWhitespace: true }),
    "/home/me/project/docs/My File.md",
  );
  assert.equal(resolveAutomaticFilePath("docs/My%20File.md", workspace), null);
  assert.equal(resolveAutomaticFilePath("https://example.com/file.ts", workspace), null);
  assert.equal(resolveAutomaticFilePath("//example.com/file.ts", workspace), null);
  assert.equal(resolveAutomaticFilePath("example.com/file.ts", workspace), null);
  assert.equal(resolveAutomaticFilePath("www.example.com/file.ts", workspace), null);
  assert.equal(resolveAutomaticFilePath("components/AppShell.tsx?download=1", workspace), null);
  assert.equal(resolveAutomaticFilePath("components/AppShell.tsx#section", workspace), null);
  assert.equal(
    resolveAutomaticFilePath("components/AppShell.tsx#L42-L50", workspace),
    "/home/me/project/components/AppShell.tsx",
  );
});

test("scans prose punctuation, quotes, line suffixes, and recognized bare filenames", async () => {
  const { findAutomaticFilePathMatches } = await loadSubject();
  const workspace = "/home/me/project";
  const text = 'See (components/AppShell.tsx:42), "docs/My File.md", and Dockerfile.';

  assert.deepEqual(findAutomaticFilePathMatches(text, workspace).map(({ displayText, filePath }) => ({ displayText, filePath })), [
    { displayText: "components/AppShell.tsx:42", filePath: "/home/me/project/components/AppShell.tsx" },
    { displayText: "docs/My File.md", filePath: "/home/me/project/docs/My File.md" },
    { displayText: "Dockerfile", filePath: "/home/me/project/Dockerfile" },
  ]);
});

test("keeps traversal, external URLs, binaries, and ambiguous prose inert", async () => {
  const { findAutomaticFilePathMatches } = await loadSubject();
  const workspace = "/home/me/project";
  const text = [
    "https://example.com/file.ts", "../outside.ts", "/home/me/other/file.ts",
    "image.png", "report.pdf", "payload.bin", "foo/bar", "version 1.2.3",
    "not/a path.md", "docs/My Folder/file.ts", "`fenced-looking-but-text.ts`",
  ].join(" ");

  assert.deepEqual(findAutomaticFilePathMatches(text, workspace), []);
});

test("recovers after unrelated slash prose without linking unquoted path suffixes", async () => {
  const { findAutomaticFilePathMatches } = await loadSubject();
  const workspace = "/home/me/project";

  for (const text of [
    "Compare input/output behavior in components/AppShell.tsx.",
    "Compare input/output then components/AppShell.tsx.",
    "Open docs/My folder.ts, then components/AppShell.tsx.",
    "Open docs/My folder.ts: components/AppShell.tsx.",
    "Open docs/My folder.ts) components/AppShell.tsx.",
    "Open docs/My folder.ts] components/AppShell.tsx.",
    "Open docs/My folder.ts} components/AppShell.tsx.",
    "Open docs/My folder.ts… components/AppShell.tsx.",
  ]) {
    assert.deepEqual(
      findAutomaticFilePathMatches(text, workspace)
        .map(({ displayText, filePath }) => ({ displayText, filePath })),
      [{ displayText: "components/AppShell.tsx", filePath: "/home/me/project/components/AppShell.tsx" }],
    );
  }
  for (const text of [
    "Open docs/My Folder Name/file.ts after review.",
    "Open docs/My Very Long Folder/file.ts after review.",
    "Open docs/My Folder With Spaces/file.ts after review.",
    "Open docs/My folder.ts components/AppShell.tsx after review.",
    "Open docs/My src/file.ts ordinary words components/AppShell.tsx after review.",
  ]) {
    assert.deepEqual(findAutomaticFilePathMatches(text, workspace), []);
  }
});

test("applies Windows and UNC containment without sibling-prefix escapes", async () => {
  const {
    buildAssistantFileActionHref,
    resolveAssistantFileActionHref,
    resolveAutomaticFilePath,
  } = await loadSubject();

  const windowsPath = resolveAutomaticFilePath("C:\\Repo\\Task\\src\\file.TS:9", "c:/repo/task");
  assert.equal(windowsPath, "C:/Repo/Task/src/file.TS");
  assert.equal(resolveAutomaticFilePath("C:\\Repo\\Task2\\file.ts", "C:/Repo/Task"), null);
  const uncPath = resolveAutomaticFilePath(
    "\\\\SERVER\\Share\\Task\\src\\file.ts",
    "\\\\server\\share\\task",
  );
  assert.equal(uncPath, "//SERVER/Share/Task/src/file.ts");
  assert.equal(resolveAutomaticFilePath("\\\\server\\share\\task2\\file.ts", "\\\\server\\share\\task"), null);

  assert.equal(
    resolveAssistantFileActionHref(buildAssistantFileActionHref(windowsPath), "c:/repo/task"),
    windowsPath,
  );
  assert.equal(
    resolveAssistantFileActionHref(buildAssistantFileActionHref(uncPath), "\\\\server\\share\\task"),
    uncPath,
  );
  assert.equal(
    resolveAssistantFileActionHref(buildAssistantFileActionHref("C:/Repo/Task2/file.ts"), "C:/Repo/Task"),
    null,
  );
});

test("scans unmatched quoted delimiters in bounded linear time", async () => {
  const { findAutomaticFilePathMatches } = await loadSubject();
  const text = Array.from({ length: 20_000 }, () => "“").join(" ");
  const started = performance.now();

  assert.deepEqual(findAutomaticFilePathMatches(text, "/home/me/project"), []);
  assert.ok(performance.now() - started < 500, "unmatched quote scanning should remain bounded");
});

test("scans long path-heavy prose locally with bounded output", async () => {
  const { findAutomaticFilePathMatches } = await loadSubject();
  const previousFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = () => { fetchCalls += 1; throw new Error("unexpected fetch"); };
  try {
    const text = Array.from({ length: 2_000 }, (_, index) => `src/file-${index}.ts`).join(" ");
    const matches = findAutomaticFilePathMatches(text, "/home/me/project");
    assert.equal(matches.length, 2_000);
    assert.equal(matches[0].filePath, "/home/me/project/src/file-0.ts");
    assert.equal(matches.at(-1).filePath, "/home/me/project/src/file-1999.ts");
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
