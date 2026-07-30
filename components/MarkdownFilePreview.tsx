"use client";

import type { MouseEvent } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import { getFileDirectory } from "@/lib/file-paths";
import { resolveLocalFileHref } from "@/lib/file-links";
import { markdownPreviewRehypePlugins, markdownPreviewRemarkPlugins } from "@/lib/markdown";

interface MarkdownFilePreviewProps {
  markdown: string;
  filePath: string;
  cwd?: string;
  onOpenFile?: (filePath: string) => void;
}

export function MarkdownFilePreview({
  markdown,
  filePath,
  cwd,
  onOpenFile,
}: MarkdownFilePreviewProps) {
  const markdownDirectory = getFileDirectory(filePath);

  const markdownComponents: Components = {
    p({ node, children, className, ...props }) {
      const onlyChild = node?.children.length === 1 ? node.children[0] : null;
      const linkedChild = onlyChild?.type === "element" && onlyChild.tagName === "a" && onlyChild.children.length === 1
        ? onlyChild.children[0]
        : null;
      const isStandaloneMedia = onlyChild?.type === "element" && onlyChild.tagName === "img"
        || linkedChild?.type === "element" && linkedChild.tagName === "img";

      return (
        <p
          {...props}
          className={[className, isStandaloneMedia ? "markdown-file-media-block" : null]
            .filter(Boolean)
            .join(" ") || undefined}
        >
          {children}
        </p>
      );
    },
    a({ href, children, ...props }) {
      delete props.node;
      const linkedFile = onOpenFile
        ? resolveLocalFileHref(href, markdownDirectory, cwd ?? markdownDirectory)
        : null;
      if (!linkedFile || !onOpenFile) {
        return <a href={href} {...props}>{children}</a>;
      }

      const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
        if (event.defaultPrevented || event.button !== 0) return;
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        onOpenFile(linkedFile);
      };

      return <a href={href} {...props} onClick={handleClick}>{children}</a>;
    },
    table({ children, ...props }) {
      delete props.node;
      return (
        <div className="markdown-file-table-wrap">
          <table {...props}>{children}</table>
        </div>
      );
    },
    img({ className, alt, ...props }) {
      delete props.node;
      return (
        // Markdown images have arbitrary runtime sources, so next/image is not applicable.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          {...props}
          alt={alt ?? ""}
          className={[className, "markdown-file-media"].filter(Boolean).join(" ")}
        />
      );
    },
  };

  return (
    <div className="markdown-body markdown-file-preview">
      <ReactMarkdown
        remarkPlugins={markdownPreviewRemarkPlugins}
        rehypePlugins={markdownPreviewRehypePlugins}
        components={markdownComponents}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
