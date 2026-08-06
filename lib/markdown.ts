import type { Options as ReactMarkdownOptions } from "react-markdown";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import {
  ASSISTANT_FILE_ACTION_CLASS,
  buildAssistantFileActionHref,
  findAutomaticFilePathMatches,
  resolveAutomaticFilePath,
} from "./file-links";

interface MarkdownAstNode {
  type: string;
  value?: string;
  url?: string;
  children?: MarkdownAstNode[];
  data?: {
    hProperties?: Record<string, unknown>;
  };
}

function automaticFileLink(filePath: string, child: MarkdownAstNode): MarkdownAstNode {
  return {
    type: "link",
    url: buildAssistantFileActionHref(filePath),
    data: { hProperties: { className: [ASSISTANT_FILE_ACTION_CLASS] } },
    children: [child],
  };
}

function transformAssistantFileLinks(node: MarkdownAstNode, workspace: string): void {
  if (!node.children || node.type === "link" || node.type === "linkReference" || node.type === "code" || node.type === "html") {
    return;
  }

  const nextChildren: MarkdownAstNode[] = [];
  for (const child of node.children) {
    if (child.type === "text" && typeof child.value === "string") {
      const matches = findAutomaticFilePathMatches(child.value, workspace);
      if (matches.length === 0) {
        nextChildren.push(child);
        continue;
      }

      let cursor = 0;
      for (const match of matches) {
        if (match.start > cursor) nextChildren.push({ type: "text", value: child.value.slice(cursor, match.start) });
        nextChildren.push(automaticFileLink(
          match.filePath,
          { type: "text", value: match.displayText },
        ));
        cursor = match.end;
      }
      if (cursor < child.value.length) nextChildren.push({ type: "text", value: child.value.slice(cursor) });
      continue;
    }

    if (child.type === "inlineCode" && typeof child.value === "string" && child.value === child.value.trim()) {
      const filePath = resolveAutomaticFilePath(child.value, workspace, { allowWhitespace: true });
      nextChildren.push(filePath ? automaticFileLink(filePath, child) : child);
      continue;
    }

    transformAssistantFileLinks(child, workspace);
    nextChildren.push(child);
  }
  node.children = nextChildren;
}

export function remarkAssistantFileLinks({ workspace }: { workspace?: string } = {}) {
  return (tree: MarkdownAstNode) => {
    if (workspace) transformAssistantFileLinks(tree, workspace);
  };
}

const markdownSanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    a: [
      ...(defaultSchema.attributes?.a ?? []).filter((attribute) => (
        !Array.isArray(attribute) || attribute[0] !== "className"
      )),
      ["className", "data-footnote-backref", ASSISTANT_FILE_ACTION_CLASS],
    ],
    code: [["className", /^language-./, "math-inline", "math-display"]],
  },
  strip: [...(defaultSchema.strip || []), "iframe", "object", "style", "form"],
};

export const markdownRemarkPlugins: ReactMarkdownOptions["remarkPlugins"] = [remarkGfm, remarkMath];
export const markdownPreviewRemarkPlugins: ReactMarkdownOptions["remarkPlugins"] = [remarkGfm];

export const markdownRehypePlugins: ReactMarkdownOptions["rehypePlugins"] = [
  rehypeRaw,
  [rehypeSanitize, markdownSanitizeSchema],
  [rehypeKatex, { throwOnError: false, strict: false }],
];

export const markdownPreviewRehypePlugins: ReactMarkdownOptions["rehypePlugins"] = [
  rehypeRaw,
  [rehypeSanitize, markdownSanitizeSchema],
];
