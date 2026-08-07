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
const { MarkdownFilePreview } = await jiti.import("./MarkdownFilePreview.tsx");
const { MarkdownBody } = await jiti.import("./MarkdownBody.tsx");

function renderFileMarkdown(markdown, props = {}) {
  return renderToStaticMarkup(
    React.createElement(MarkdownFilePreview, {
      markdown,
      filePath: "/home/me/project/docs/readme.md",
      cwd: "/home/me/project",
      onOpenFile() {},
      ...props,
    }),
  );
}

test("preserves Explorer link markup for local and external links", () => {
  const html = renderFileMarkdown("[local](../components/AppShell.tsx) [external](https://example.com/docs)");

  assert.match(html, /class="markdown-body markdown-file-preview"/);
  assert.match(html, /<a href="\.\.\/components\/AppShell\.tsx">local<\/a>/);
  assert.match(html, /<a href="https:\/\/example\.com\/docs">external<\/a>/);
  assert.doesNotMatch(html, /target=|rel=|\snode=/);
});

test("wraps GFM tables in the Explorer overflow surface", () => {
  const html = renderFileMarkdown("| Name | Value |\n| --- | --- |\n| alpha | beta |");

  assert.match(html, /<div class="markdown-file-table-wrap"><table>/);
  assert.match(html, /<thead>/);
  assert.match(html, /<tbody>/);
  assert.match(html, /<th>Name<\/th>/);
  assert.match(html, /<td>beta<\/td>/);
});

test("marks standalone images as wide responsive media", () => {
  const html = renderFileMarkdown("![Architecture](architecture.png)");

  assert.match(html, /<p class="markdown-file-media-block">/);
  assert.match(html, /<img (?=[^>]*class="markdown-file-media")(?=[^>]*src="architecture\.png")(?=[^>]*alt="Architecture")[^>]*\/>/);
});

test("marks standalone raw HTML images for the direct wide-media rule", () => {
  const html = renderFileMarkdown('<img src="raw-image.png" alt="Raw image" />');

  assert.match(html, /<div class="markdown-body markdown-file-preview"><img (?=[^>]*class="markdown-file-media")(?=[^>]*src="raw-image\.png")[^>]*\/><\/div>/);
  assert.doesNotMatch(html, /markdown-file-media-block/);
});

test("keeps mixed inline images in the reading block", () => {
  const html = renderFileMarkdown("Before ![status](status.png) after.");

  assert.match(html, /<p>Before <img [^>]*class="markdown-file-media"[^>]*\/> after\.<\/p>/);
  assert.doesNotMatch(html, /markdown-file-media-block/);
});

test("recognizes a linked image as standalone media", () => {
  const html = renderFileMarkdown("[![Diagram](diagram.png)](full-size.png)");

  assert.match(html, /<p class="markdown-file-media-block"><a href="full-size\.png"><img [^>]*class="markdown-file-media"[^>]*\/><\/a><\/p>/);
});

test("Explorer typography consumes one file-only base and proportional fixed baselines", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

  assert.match(css, /\.markdown-body\s*\{[\s\S]*?font-size:\s*14px;/, "generic Markdown keeps its existing base");
  assert.match(css, /\.chat-width-container \.markdown-body\s*\{\s*font-size:\s*var\(--pi-transcript-font-size, 16px\);\s*\}/);
  assert.match(css, /\.markdown-file-preview\s*\{[\s\S]*?font-size:\s*var\(--pi-file-viewer-font-size, 14px\);[\s\S]*?\}/);
  assert.match(css, /\.markdown-file-preview pre\s*\{[\s\S]*?font-size:\s*calc\(13px \* var\(--pi-file-viewer-font-scale, 1\)\);[\s\S]*?\}/);
  assert.match(css, /\.markdown-file-table-wrap table\s*\{[\s\S]*?font-size:\s*calc\(13px \* var\(--pi-file-viewer-font-scale, 1\)\);[\s\S]*?\}/);
  assert.match(css, /\.markdown-file-preview h1\s*\{\s*font-size:\s*1\.8em;\s*\}/);
  assert.match(css, /\.markdown-file-preview code\s*\{[\s\S]*?font-size:\s*0\.9em;[\s\S]*?\}/);
  assert.doesNotMatch(css, /\.chat-width-container[^{]*--pi-file-viewer-font/);
});

test("does not leak Explorer table or media hooks into chat Markdown", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      MarkdownBody,
      { cwd: "/home/me/project", onOpenFile() {} },
      "| A | B |\n| --- | --- |\n| 1 | 2 |\n\n![chat](chat.png)",
    ),
  );

  assert.match(html, /class="markdown-table-wrap"/);
  assert.doesNotMatch(html, /markdown-file-preview|markdown-file-table-wrap|markdown-file-media/);
});
