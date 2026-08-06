import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { MarkdownBody } = await jiti.import("./MarkdownBody.tsx");
const { MessageView } = await jiti.import("./MessageView.tsx");

function renderMarkdown(markdown, props = {}) {
  return renderToStaticMarkup(
    React.createElement(MarkdownBody, {
      cwd: "/home/me/project",
      onOpenFile() {},
      ...props,
    }, markdown),
  );
}

test("opens non-file markdown links in a safe new tab", () => {
  const html = renderMarkdown("[docs](https://example.com/docs)", { enableAutomaticFileLinks: true });

  assert.match(
    html,
    /<a (?=[^>]*href="https:\/\/example\.com\/docs")(?=[^>]*target="_blank")(?=[^>]*rel="noopener noreferrer")[^>]*>docs<\/a>/,
  );
  assert.doesNotMatch(html, /\snode=/);
});

test("keeps local file markdown links in the app", () => {
  const html = renderMarkdown("[file](components/MarkdownBody.tsx) [query](components/AppShell.tsx?view=source#L42)");

  assert.match(html, /<a href="components\/MarkdownBody\.tsx">file<\/a>/);
  assert.match(html, /<a href="components\/AppShell\.tsx\?view=source#L42">query<\/a>/);
  assert.doesNotMatch(html, /target=|rel=|\snode=/);
});

test("keeps anchors and query-only links as ordinary browser links", () => {
  const html = renderMarkdown("[anchor](#section) [query](?view=all)");

  assert.match(html, /<a (?=[^>]*href="#section")(?=[^>]*target="_blank")[^>]*>anchor<\/a>/);
  assert.match(html, /<a (?=[^>]*href="\?view=all")(?=[^>]*target="_blank")[^>]*>query<\/a>/);
});

test("renders completed Mermaid blocks as Preview by default", () => {
  const html = renderMarkdown("```mermaid\nflowchart LR\nA-->B\n```");

  assert.match(html, />Source<\/button>/);
  assert.match(html, /aria-label="Show Mermaid source"/);
  assert.match(html, /class="mermaid-block mermaid-block-loading"/);
  assert.doesNotMatch(html, />Preview<\/button>/);
});

test("keeps streaming Mermaid as source with Preview unavailable", () => {
  const html = renderMarkdown("```mermaid\nflowchart LR\nA-->B\n```", { isStreaming: true });

  assert.match(html, /<button[^>]*disabled=""[^>]*>Preview<\/button>/);
  assert.match(html, /aria-label="Preview available after streaming"/);
  assert.match(html, /flowchart/);
  assert.doesNotMatch(html, /class="mermaid-block/);
});

test("creates an independent default Preview for each completed Mermaid block", () => {
  const html = renderMarkdown([
    "```mermaid",
    "flowchart LR",
    "A-->B",
    "```",
    "",
    "```mermaid",
    "sequenceDiagram",
    "A->>B: Hello",
    "```",
  ].join("\n"));

  assert.equal((html.match(/>Source<\/button>/g) ?? []).length, 2);
  assert.equal((html.match(/class="mermaid-block mermaid-block-loading"/g) ?? []).length, 2);
});

test("renders settled assistant prose and whole inline-code paths as semantic file actions", () => {
  const html = renderMarkdown(
    'See components/MarkdownBody.tsx:42, "docs/My File.md", and `config/My Config.json`.',
    { enableAutomaticFileLinks: true },
  );

  assert.equal((html.match(/<button type="button" class="assistant-file-action"/g) ?? []).length, 3);
  assert.match(html, /aria-label="Open file components\/MarkdownBody\.tsx:42"/);
  assert.match(html, /<button[^>]*><code class="markdown-inline-code">config\/My Config\.json<\/code><\/button>/);
  assert.match(html, /&quot;<button[^>]*>docs\/My File\.md<\/button>&quot;/);
  assert.doesNotMatch(html, /href="\/home\/me\/project\/components\/MarkdownBody\.tsx"/);
});

test("keeps automatic recognition assistant-only and inactive while streaming", () => {
  const markdown = "components/MarkdownBody.tsx [authored](components/AppShell.tsx)";
  const ordinary = renderMarkdown(markdown);
  const streaming = renderMarkdown(markdown, { enableAutomaticFileLinks: true, isStreaming: true });
  const assistant = renderToStaticMarkup(React.createElement(MessageView, {
    message: { role: "assistant", content: [{ type: "text", text: "components/AppShell.tsx" }] },
    cwd: "/home/me/project",
    onOpenFile() {},
  }));
  const user = renderToStaticMarkup(React.createElement(MessageView, {
    message: { role: "user", content: "components/AppShell.tsx" },
    cwd: "/home/me/project",
    onOpenFile() {},
  }));

  assert.doesNotMatch(ordinary, /assistant-file-action/);
  assert.doesNotMatch(streaming, /assistant-file-action/);
  assert.match(streaming, /<a href="components\/AppShell\.tsx">authored<\/a>/);
  assert.match(assistant, /assistant-file-action/);
  assert.doesNotMatch(user, /assistant-file-action/);
});

test("does not treat an unquoted whitespace path as a partial file action", () => {
  for (const markdown of [
    "Open docs/My File.md and docs/My Very Long Folder/file.ts after review.",
    "Open docs/My folder.ts components/AppShell.tsx after review.",
    "Open docs/My src/file.ts ordinary words components/AppShell.tsx after review.",
  ]) {
    const html = renderMarkdown(markdown, { enableAutomaticFileLinks: true });
    assert.doesNotMatch(html, /assistant-file-action/);
  }
});

test("recovers automatic recognition after unrelated slash prose", () => {
  for (const markdown of [
    "Compare input/output behavior in components/AppShell.tsx.",
    "Compare input/output then components/AppShell.tsx.",
    "Open docs/My folder.ts, then components/AppShell.tsx.",
    "Open docs/My folder.ts) components/AppShell.tsx.",
    "Open docs/My folder.ts… components/AppShell.tsx.",
  ]) {
    const html = renderMarkdown(markdown, { enableAutomaticFileLinks: true });
    assert.equal((html.match(/class="assistant-file-action"/g) ?? []).length, 1);
    assert.match(html, />components\/AppShell\.tsx<\/button>/);
  }
});

test("does not rewrite authored links, fenced code, non-path inline code, or unsupported paths", () => {
  const html = renderMarkdown([
    "[authored](components/AppShell.tsx)",
    "",
    "`not a path` `report.pdf` /home/me/outside/file.ts",
    "",
    "```",
    "components/MarkdownBody.tsx",
    "```",
  ].join("\n"), { enableAutomaticFileLinks: true });

  assert.match(html, /<a href="components\/AppShell\.tsx">authored<\/a>/);
  assert.equal((html.match(/<a href="components\/AppShell\.tsx">/g) ?? []).length, 1);
  assert.doesNotMatch(html, /assistant-file-action/);
  assert.match(html, /<code class="markdown-inline-code">report\.pdf<\/code>/);
  assert.match(html, /components\/MarkdownBody\.tsx/);
});

test("preserves only the narrow generated action class through sanitization", () => {
  const generated = renderMarkdown("components/MarkdownBody.tsx", { enableAutomaticFileLinks: true });
  const windows = renderMarkdown("`C:\\Repo\\Task\\src\\file.ts`", {
    cwd: "C:/Repo/Task",
    enableAutomaticFileLinks: true,
  });
  const unc = renderMarkdown("`\\\\server\\share\\task\\src\\file.ts`", {
    cwd: "\\\\server\\share\\task",
    enableAutomaticFileLinks: true,
  });
  const raw = renderMarkdown('<a class="evil" data-unsafe="yes" href="components/AppShell.tsx">raw</a>');

  assert.match(generated, /class="assistant-file-action"/);
  assert.match(windows, /class="assistant-file-action"/);
  assert.match(unc, /class="assistant-file-action"/);
  assert.doesNotMatch(generated, /data-unsafe|class="evil"/);
  assert.doesNotMatch(raw, /class="evil"|data-unsafe/);
});
