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
  const html = renderMarkdown("[docs](https://example.com/docs)");

  assert.match(
    html,
    /<a (?=[^>]*href="https:\/\/example\.com\/docs")(?=[^>]*target="_blank")(?=[^>]*rel="noopener noreferrer")[^>]*>docs<\/a>/,
  );
  assert.doesNotMatch(html, /\snode=/);
});

test("keeps local file markdown links in the app", () => {
  const html = renderMarkdown("[file](components/MarkdownBody.tsx)");

  assert.match(html, /<a href="components\/MarkdownBody\.tsx">file<\/a>/);
  assert.doesNotMatch(html, /target=|rel=|\snode=/);
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
