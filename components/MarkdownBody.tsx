"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vs } from "react-syntax-highlighter/dist/cjs/styles/prism";
import { vscDarkPlus } from "react-syntax-highlighter/dist/cjs/styles/prism";
import { useTheme } from "@/hooks/useTheme";
import { useDisplayPreferences } from "@/hooks/useDisplayPreferences";
import { copyText } from "@/lib/clipboard";
import { resolveLocalFileHref } from "@/lib/file-links";
import { markdownRehypePlugins, markdownRemarkPlugins } from "@/lib/markdown";
import {
  DEFAULT_MERMAID_VIEW,
  buildMermaidRenderKey,
  buildMermaidViewStateKey,
  enqueueMermaidOperation,
  getMermaidModeState,
  mermaidDisplayConfig,
  type MermaidView,
} from "@/lib/mermaid-display";

const SYNTAX_PRE_SELECTOR = 'pre[class*="language-"]';

function withoutSyntaxBackground(theme: typeof vs): typeof vs {
  const preStyle = { ...theme[SYNTAX_PRE_SELECTOR] };
  delete preStyle.background;
  delete preStyle.backgroundColor;
  return { ...theme, [SYNTAX_PRE_SELECTOR]: preStyle };
}

const lightSyntaxStyle = withoutSyntaxBackground(vs);
const darkSyntaxStyle = withoutSyntaxBackground(vscDarkPlus);

interface MarkdownBodyProps {
  children: string;
  className?: string;
  isStreaming?: boolean;
  cwd?: string;
  onOpenFile?: (filePath: string) => void;
  mermaidTextBlockIdentity?: string;
  mermaidViewSelections?: ReadonlyMap<string, MermaidView>;
  onMermaidViewChange?: (key: string, view: MermaidView) => void;
}

export function MarkdownBody({
  children,
  className,
  isStreaming,
  cwd,
  onOpenFile,
  mermaidTextBlockIdentity,
  mermaidViewSelections,
  onMermaidViewChange,
}: MarkdownBodyProps) {
  const normalizedMarkdown = useMemo(() => normalizeDisplayMath(children), [children]);
  // Read controlled selections through a ref so a mode click does not replace
  // react-markdown's renderer functions and remount every code block.
  const mermaidViewSelectionsRef = useRef(mermaidViewSelections);
  mermaidViewSelectionsRef.current = mermaidViewSelections;
  const markdownComponents = useMemo<Components>(() => ({
    code({ className, children, node, ...props }) {
      const lang = className?.replace("language-", "").toLowerCase() ?? "";
      const raw = String(children);
      const isBlock = className?.includes("language-") || raw.includes("\n");
      if (isBlock) {
        if (lang === "mermaid") {
          const viewStateKey = buildMermaidViewStateKey(mermaidTextBlockIdentity, node?.position?.start);
          return (
            <MermaidBlock
              code={raw.replace(/\n$/, "")}
              isStreaming={isStreaming}
              selectedView={viewStateKey ? mermaidViewSelectionsRef.current?.get(viewStateKey) : undefined}
              onSelectedViewChange={viewStateKey && onMermaidViewChange
                ? (view) => onMermaidViewChange(viewStateKey, view)
                : undefined}
            />
          );
        }
        return <CodeBlock code={raw.replace(/\n$/, "")} lang={lang} />;
      }
      return (
        <code
          className="markdown-inline-code"
          {...props}
        >
          {children}
        </code>
      );
    },
    pre({ children }) {
      return <>{children}</>;
    },
    a({ href, children, ...props }) {
      // `node` is react-markdown metadata, not a DOM attribute.
      delete props.node;
      const filePath = onOpenFile ? resolveLocalFileHref(href, cwd) : null;
      const openFile = onOpenFile;
      if (!filePath || !openFile) {
        return (
          <a href={href} {...props} target="_blank" rel="noopener noreferrer">
            {children}
          </a>
        );
      }

      const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
        if (event.defaultPrevented || event.button !== 0) return;
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const target = event.currentTarget.getAttribute("target");
        if (target && target !== "_self") return;
        event.preventDefault();
        openFile(filePath);
      };

      return (
        <a href={href} {...props} onClick={handleClick}>
          {children}
        </a>
      );
    },
    table({ children }) {
      return (
        <div className="markdown-table-wrap">
          <table>{children}</table>
        </div>
      );
    },
  }), [cwd, isStreaming, mermaidTextBlockIdentity, onMermaidViewChange, onOpenFile]);

  return (
    <div className={["markdown-body", className].filter(Boolean).join(" ")}>
      <ReactMarkdown
        remarkPlugins={markdownRemarkPlugins}
        rehypePlugins={markdownRehypePlugins}
        components={markdownComponents}
      >
        {normalizedMarkdown}
      </ReactMarkdown>
    </div>
  );
}

function normalizeDisplayMath(markdown: string): string {
  const lineBreak = markdown.includes("\r\n") ? "\r\n" : "\n";
  const lines = markdown.split(/\r?\n/);
  let fence: { marker: string; size: number } | null = null;

  return lines
    .map((line) => {
      const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})/);
      if (fenceMatch) {
        const marker = fenceMatch[1][0];
        const size = fenceMatch[1].length;
        if (!fence) fence = { marker, size };
        else if (marker === fence.marker && size >= fence.size) fence = null;
        return line;
      }

      if (fence) return line;

      const displayMathMatch = line.match(/^([ \t]{0,3})\$\$(.+)\$\$[ \t]*$/);
      if (!displayMathMatch) return line;

      const math = displayMathMatch[2].trim();
      if (!math) return line;

      return `${displayMathMatch[1]}$$${lineBreak}${math}${lineBreak}${displayMathMatch[1]}$$`;
    })
    .join(lineBreak);
}

function MermaidBlock({
  code,
  isStreaming,
  selectedView,
  onSelectedViewChange,
}: {
  code: string;
  isStreaming?: boolean;
  selectedView?: MermaidView;
  onSelectedViewChange?: (view: MermaidView) => void;
}) {
  const { isDark } = useTheme();
  const { transcriptFontSize } = useDisplayPreferences();
  const [localSelectedView, setLocalSelectedView] = useState<MermaidView>(DEFAULT_MERMAID_VIEW);
  const currentSelectedView = onSelectedViewChange
    ? selectedView ?? DEFAULT_MERMAID_VIEW
    : localSelectedView;
  const { effectiveView, action } = getMermaidModeState(currentSelectedView, isStreaming);
  const [svg, setSvg] = useState<string | null>(null);
  const [renderedKey, setRenderedKey] = useState("");
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const [failureSignal, setFailureSignal] = useState<{ stage: "load" | "parse" | "render"; name: string } | null>(null);
  const [renderStage, setRenderStage] = useState("idle");
  const previewRef = useRef<HTMLDivElement>(null);
  const currentKey = buildMermaidRenderKey(isDark, transcriptFontSize, code);

  useLayoutEffect(() => {
    if (renderedKey !== currentKey) return;
    const svgElement = previewRef.current?.querySelector("svg");
    const viewBox = svgElement?.viewBox.baseVal;
    if (!svgElement || !viewBox || !Number.isFinite(viewBox.width) || viewBox.width <= 0) return;

    svgElement.setAttribute("width", String(viewBox.width));
    svgElement.dataset.mermaidNaturalWidth = String(viewBox.width);
    svgElement.style.setProperty("width", `${viewBox.width}px`, "important");
    svgElement.style.setProperty("height", "auto", "important");
    svgElement.style.setProperty("max-width", "none", "important");
  }, [currentKey, renderedKey, svg]);

  useEffect(() => {
    if (effectiveView !== "preview") return;

    let cancelled = false;
    let failureStage: "load" | "parse" | "render" = "load";
    setFailedKey(null);
    setFailureSignal(null);
    setRenderStage("loading-library");

    const render = async () => {
      const { default: mermaid } = await import("mermaid");
      if (cancelled) return;
      setRenderStage("queued");
      const result = await enqueueMermaidOperation(async () => {
        if (cancelled) return null;

        setRenderStage("configuring");
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          suppressErrorRendering: true,
          theme: isDark ? "dark" : "default",
          ...mermaidDisplayConfig(transcriptFontSize),
        });

        failureStage = "parse";
        setRenderStage("parsing");
        const parsed = await mermaid.mermaidAPI.parse(code, { suppressErrors: true });
        if (!parsed) throw new Error("Invalid Mermaid diagram");

        failureStage = "render";
        setRenderStage("rendering");
        const id =
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? `mermaid-${crypto.randomUUID()}`
            : `mermaid-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        return mermaid.mermaidAPI.render(id, code);
      });

      if (result && !cancelled) {
        setSvg(result.svg);
        setRenderedKey(currentKey);
        setRenderStage("complete");
      }
    };

    render().catch((error: unknown) => {
      if (!cancelled) {
        setFailedKey(currentKey);
        setFailureSignal({
          stage: failureStage,
          name: error instanceof Error ? error.name : "UnknownError",
        });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [code, currentKey, effectiveView, isDark, transcriptFontSize]);

  const previewButton = (
    <button
      type="button"
      onClick={() => {
        if (onSelectedViewChange) onSelectedViewChange(action.destination);
        else setLocalSelectedView(action.destination);
      }}
      disabled={action.disabled}
      title={action.title}
      aria-label={action.title}
      className={["markdown-code-action", effectiveView === "preview" ? "is-active" : ""].filter(Boolean).join(" ")}
    >
      {action.label}
    </button>
  );

  if (effectiveView === "source") {
    return <CodeBlock code={code} lang="mermaid" headerAction={previewButton} />;
  }

  const body =
    failedKey === currentKey ? (
      <div
        className="mermaid-block mermaid-block-error"
        data-mermaid-error-stage={failureSignal?.stage ?? "unknown"}
        data-mermaid-error-name={failureSignal?.name ?? "UnknownError"}
      >
        Invalid Mermaid diagram
      </div>
    ) : !svg || renderedKey !== currentKey ? (
      <div
        className="mermaid-block mermaid-block-loading"
        aria-label="Rendering Mermaid diagram"
        data-mermaid-render-stage={renderStage}
      />
    ) : (
      <div
        ref={previewRef}
        className="mermaid-block"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    );

  return (
    <div className="markdown-code-block">
      <div className="markdown-code-header">
        <span className="markdown-code-lang">mermaid</span>
        {previewButton}
      </div>
      {body}
    </div>
  );
}

function CodeBlock({ code, lang, headerAction }: { code: string; lang: string; headerAction?: ReactNode }) {
  const { isDark } = useTheme();
  const [copied, setCopied] = useState(false);

  const copy = () => {
    copyText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="markdown-code-block">
      <div className="markdown-code-header">
        <span className="markdown-code-lang">{lang || "text"}</span>
        <div className="markdown-code-actions">
          {headerAction}
          <button
            onClick={copy}
            className="markdown-code-action"
          >
            {copied ? "copied" : "copy"}
          </button>
        </div>
      </div>
      <SyntaxHighlighter
        language={lang || "text"}
        style={isDark ? darkSyntaxStyle : lightSyntaxStyle}
        showLineNumbers
        lineNumberStyle={{ color: "var(--text-dim)", fontStyle: "normal" }}
        customStyle={{
          margin: 0,
          padding: "11px 13px",
          fontSize: "var(--pi-transcript-font-size, 16px)",
          lineHeight: 1.62,
          borderRadius: 0,
          backgroundColor: "color-mix(in srgb, var(--bg) 92%, var(--bg-panel))",
        }}
        codeTagProps={{ style: { fontFamily: "var(--font-mono)" } }}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
}
