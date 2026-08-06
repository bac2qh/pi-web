# Open Agent-Returned File Paths in the Viewer

Status: approved
Date: 2026-08-05
Approved by user: 2026-08-05

## Objective

Make eligible local file paths in agent response text directly clickable so a click opens the existing Pi Web file viewer, while preserving ordinary web links and preventing binary, unsupported, or oversized files from creating an unsafe or unresponsive preview.

Success means:

- the agreed path forms in assistant text become file-viewer actions without the agent having to emit explicit Markdown link syntax;
- eligible relative paths resolve from the exact session working directory, while an automatic absolute-path action is offered only when the resolved file remains inside that same workspace;
- at viewport widths of at least 1000px, the automatic file action uses the normal direct viewer-open behavior; below 1000px, the first tap reveals an explicit **Open file** confirmation;
- every file-open origin below 1000px—including a confirmed agent path, Explorer, and authored Markdown links—opens an effectively full-width viewer, while wider viewports preserve the existing normal panel behavior;
- existing explicit local Markdown links continue to work;
- external URLs, non-file text, fenced code, unsupported binary/document paths, and paths outside the existing file authorization boundary are not granted a new preview route;
- oversized text fails in a bounded, understandable way rather than being loaded and syntax-highlighted in the browser.

## Design / Implementation Strategy

Pi Web already handles one narrow case: when a message contains an actual Markdown link such as `[Open the plan](.agents/plans/example.md)`, `ReactMarkdown` creates an anchor, `MarkdownBody` recognizes its `href` as a local file, prevents ordinary browser navigation, resolves the file against the session cwd, and calls `AppShell` to create or select a tab in the existing right-side `FileViewer`. Plain text such as `.agents/plans/example.md` and inline code containing that path are not actionable today, which is why this behavior is easy to miss. This change should extend recognition to those common agent-output forms and reuse the same viewer-opening callback and tab lifecycle rather than create another viewer or direct filesystem access route.

Add a narrowly scoped, testable path-linkification stage only to assistant Markdown text. Support both conservative path mentions in ordinary prose and path values occupying an entire inline-code span. Resolve all relative forms—including recognized bare source filenames—against the exact session working directory, so a session in the main checkout or a linked worktree opens that checkout's file. Resolve absolute candidates lexically but offer an automatic action only when the normalized result remains inside that same session workspace. Support whitespace inside a candidate only when the complete path is delimited by inline-code backticks or quotes; unquoted prose recognition stops at whitespace.

Preserve the original displayed text, avoid double-linking existing anchors or touching fenced code, and emit actions that continue through the existing local-path resolver and click handler. Implement plain-prose recognition as a small Markdown AST text-node transform rather than raw Markdown rewriting, and handle inline code only when its entire value is one eligible path. Do not add a parsing dependency: recursively visit the bounded Markdown tree using local code. Mark generated links with one narrowly sanitize-allowed class/attribute so the component layer can render a semantic inline file-action control while authored Markdown links retain their current anchor behavior. Keep recognition and workspace-containment policy separate from React rendering so punctuation boundaries, line suffixes, Windows forms, traversal, false positives, and inline-code behavior can be unit tested. Keep new automatic actions inactive while an assistant block is streaming; enable them after settlement so partial path tokens do not repeatedly change element shape. Existing authored Markdown links retain their current streaming behavior and existing authorization semantics.

Limit the new automatic behavior to source/text candidates; do not automatically open PDF, image, audio, DOCX, or another binary/media renderer. Do not raise the viewer's current text-preview ceiling merely to support this feature. The server currently rejects non-image/audio/document text previews over 256 KiB before `readFileSync`, JSON transfer, line splitting, and Prism rendering; 10 MiB of syntax-highlighted source would be materially riskier, not a safe worst case.

Reuse the existing viewer request and authorization path without a new per-link or click-time file preflight. Apply a conservative, shared source/text filename policy before creating an automatic action, covering recognized Markdown, source code, configuration, and established text/source filenames anywhere inside the exact session workspace. Reuse or extract the route's existing language/filename classification rather than maintaining a divergent UI-only extension list.

Keep the existing 256 KiB stat check, then make the actual text `read` request reject NUL-bearing or invalid UTF-8 bytes before returning content. This adds no recognition-time request and scans only the already bounded buffer, while preventing common renamed/unknown binary content from reaching Markdown or Prism. Return a specific bounded unsupported/binary error that `FileViewer` already surfaces. Name/extension classification plus NUL/UTF-8 validation is not perfect content identification, but remaining text-like bytes are bounded by the existing limit and cannot enter PDF/media dispatch through an automatic action.

Render each generated path as a visually distinct semantic inline file action that preserves prose or inline-code appearance and has an accessible name containing the displayed path. Route its request to one `AppShell` owner rather than giving every transcript token document-level listeners. At widths of at least 1000px, click, tap, Enter, or Space directly invokes the existing viewer behavior. Below 1000px, the first activation—not mere focus—stores at most one pending automatic path tied to the current session/cwd and opens a small confirmation sheet/dialog showing the path with **Open file** and **Cancel** actions. Move focus into the confirmation, restore it when practical, and dismiss on Cancel, backdrop/outside activation, Escape, session/workspace change, or unmount. Confirmation must revalidate that its captured session/cwd is still current before opening so transcript or selection changes cannot open a stale path. Existing authored Markdown links do not use this guard.

Centralize narrow-width presentation at the shared `AppShell` file-open boundary so every file source behaves consistently. At 640px and below, opening already reveals the existing full-width mobile panel and must keep its normal close control. From 641px through 999px, every file open should additionally enter the existing expanded-viewer state and retain its visible restore control. At 1000px and above, Explorer, authored Markdown links, and automatic agent paths retain normal panel presentation.

Track whether expansion is manual or automatic-narrow rather than overloading one Boolean. An open panel that crosses below 1000px should gain automatic-narrow presentation; crossing back to at least 1000px should clear only automatic expansion, not a user's manual desktop expansion. Restoring at a narrow width suppresses expansion until another file-open action, while opening or rotating from 640px and below into the 641–999px range still yields full-width presentation. Closing the final tab clears either expansion source.

**Rough scope estimate**

- **Surfaces:** transcript Markdown/path parsing, local file-link helpers, responsive activation state, existing `AppShell` viewer presentation, the viewer/API eligibility boundary, styles, and focused tests; no new viewer.
- **Testability:** high for parsing and API limits; moderate for guarded touch interaction, responsive viewer presentation, click-to-tab integration, and streaming stability.
- **Implementation difficulty:** medium. The viewer plumbing and expanded mode already exist; the main risks are precise path recognition and an accessible guard that does not destabilize responsive state.

## Reference Files

- [`components/MarkdownBody.tsx`](../../components/MarkdownBody.tsx)
- [`components/MessageView.tsx`](../../components/MessageView.tsx)
- [`components/AppShell.tsx`](../../components/AppShell.tsx)
- [`components/FileViewer.tsx`](../../components/FileViewer.tsx)
- [`lib/file-links.ts`](../../lib/file-links.ts)
- [`lib/file-types.ts`](../../lib/file-types.ts)
- [`lib/markdown.ts`](../../lib/markdown.ts)
- [`lib/file-access.ts`](../../lib/file-access.ts)
- [`hooks/useIsMobile.ts`](../../hooks/useIsMobile.ts)
- [`app/globals.css`](../../app/globals.css)
- [`app/api/files/[...path]/route.ts`](../../app/api/files/%5B...path%5D/route.ts)
- [`lib/file-links.test.mjs`](../../lib/file-links.test.mjs)
- [`lib/file-types.test.mjs`](../../lib/file-types.test.mjs)
- [`components/MarkdownBody.test.mjs`](../../components/MarkdownBody.test.mjs)
- [`components/FileViewer.test.mjs`](../../components/FileViewer.test.mjs)

## User Constraints and Decisions

- The requested convenience applies to paths in agent/assistant responses, not every Markdown-producing message role.
- Automatically open only non-binary source/text files. PDF must not be automatically opened; the same exclusion applies to image, audio, DOCX, and other binary/media renderers unless the user later explicitly broadens scope.
- **2026-08-05:** Recognize paths in both ordinary prose and whole inline-code spans.
- **2026-08-05:** Resolve relative paths and recognized bare filenames from the selected session's exact working directory; this preserves main-checkout versus linked-worktree identity.
- **2026-08-05:** Do not automatically activate a path outside that exact workspace, even when the existing authored-link/session-reference authorization could read it.
- **2026-08-05:** Do not automatically recognize arbitrary extensionless paths. Established source/text names remain eligible.
- **2026-08-05:** Within the exact session workspace, automatically recognize any supported source/text file—not only `.agents/plans/**` or `.agents/**`—so plans, code, and configuration can use the same behavior.
- **2026-08-05:** Keep recognition fast: use local deterministic parsing/classification with no per-reference network or filesystem preflight, then reuse the existing viewer and its authorized text-read limit rather than raise the size ceiling.
- **2026-08-05:** Support spaces only when the complete path is delimited by inline code or quotes. Unquoted prose paths stop at whitespace; filenames should normally avoid spaces.
- Safety and responsiveness take priority over recognizing every ambiguous path.
- **2026-08-05:** At widths of at least 1000px, use normal direct viewer opening. Below 1000px, guard against accidental touches by requiring an explicit **Open file** confirmation after the initial path tap.
- **2026-08-05:** Every file opened below 1000px—from an agent-response path, Explorer, or an authored Markdown link—should occupy the full application width. Reuse the existing full-width mobile panel at 640px and below and automatically enter the existing expanded-viewer mode from 641px through 999px. This means in-app expansion, not browser page zoom.

## Constraints and Current Evidence

- Explicit Markdown links are already intercepted: `MarkdownBody` calls `resolveLocalFileHref(href, cwd)` and invokes `onOpenFile(filePath)` for an eligible local href. Plain path text and inline-code paths are currently inert because only rendered anchors use this path. On 2026-08-05, the user confirmed in the live Pi Web conversation that ordinary clicks on assistant-authored explicit links to this draft and `components/MarkdownBody.tsx` opened the existing viewer.
- `MessageView` supplies `cwd` and `onOpenFile` to user, assistant, and ordinary custom Markdown, including streaming assistant text. This feature will scope new automatic recognition to assistant text while leaving existing authored links elsewhere unchanged.
- `AppShell` opens the resolved path in the existing right-side tabbed `FileViewer` and associates transcript-originated opens with the selected session ID.
- Relative Markdown hrefs are constrained to the session working directory by `resolveLocalFileHref`. The file API separately authorizes an allowed root or an exact absolute path referenced by the selected session. This feature adds a stricter automatic-action boundary: no automatically detected path may resolve outside the exact session workspace, while authored Markdown links keep their existing behavior.
- The viewer dispatches by extension to image, audio, PDF/DOCX, or text rendering. Unknown extensions currently fall through to `readFileSync(..., "utf-8")`, which silently replaces invalid bytes; the planned bounded NUL/strict-UTF-8 check closes that common binary path at the authoritative text-read boundary.
- The server already caps text previews at `256 * 1024` bytes and image/DOCX previews at 10 MiB. PDF and audio are streamed rather than loaded through the text renderer; PDF currently has no size cap and renders in an iframe, reinforcing its exclusion from this automatic feature.
- This plan will not broaden general filesystem access, change Explorer discovery/file-selection semantics, change authored-link activation semantics, or replace the viewer. It deliberately changes only the shared under-1000px presentation reached after any file-open origin.

## Test Strategy

- Extend pure link/classifier tests for source/text eligibility, cwd/worktree containment, absolute and relative forms, bare filenames, line/column suffixes, punctuation, delimited spaces, Windows/UNC syntax, external URLs, traversal, and false positives.
- Extend Markdown/component tests for ordinary prose, quoted and whole-inline-code paths, existing authored links, fenced code, narrowly sanitized generated-action marking, settled-versus-streaming behavior, direct desktop activation, and the centralized guarded narrow-width confirmation lifecycle, including stale session/cwd rejection and dismissal/focus behavior.
- Add focused route/helper coverage for exact 256 KiB acceptance, one-byte-over rejection, valid UTF-8, invalid UTF-8, and NUL-bearing content without logging fixture contents.
- Add focused `AppShell`/responsive-state coverage where practical, then validate all file-open origins and expansion provenance in a real browser at the contract breakpoints. Do not introduce a broad DOM framework solely for this feature; extract pure state transitions if the established Node/Jiti pattern cannot exercise them directly.

## Telemetry / Debuggability

Avoid persistent or content-bearing logging. Keep rejected previews diagnosable through bounded HTTP status/error responses and a clear viewer message (for example, unauthorized, unsupported/binary, missing, or over the size limit). Tests should verify the rejection category without recording file contents or full private paths in telemetry.

## Validation Contract

| ID | What must be true | How to verify it | If it fails |
|---|---|---|---|
| VC-001 | Every agreed assistant-response path form becomes an actionable local-file link in both ordinary prose and whole inline-code spans, then opens the existing viewer tab with the correct absolute, main-checkout-relative, or worktree-relative path. | Focused parser/component tests plus a browser interaction check using absolute, nested relative, and recognized bare-filename fixtures in both Markdown contexts and distinct synthetic cwd values. | Fix recognition, cwd resolution, or callback wiring; do not ship partial path-form support silently. |
| VC-002 | Existing explicit local Markdown links and ordinary external links retain their current behavior. | Regression tests for local Markdown hrefs, `https:` links, anchors, query links, and modifier-click behavior. | Restore existing link semantics before closeout. |
| VC-003 | Existing links, fenced code, non-path inline code, and non-path prose are not spuriously rewritten; spaces work only for quoted or whole-inline-code paths; generated action metadata survives sanitization without permitting arbitrary attributes. | Unit/component fixtures covering punctuation, parentheses, Markdown nesting, URLs, quoted/unquoted spaces, inline/fenced code, ambiguous slash text, sanitization, and streaming partial text. | Narrow the recognizer or sanitization allowance; prefer false negatives over false positives. |
| VC-004 | Recognized Markdown, source, configuration, and established text/source filenames anywhere inside the workspace are eligible, while PDF, image, audio, DOCX, unknown extensions, and arbitrary extensionless paths cannot enter the new automatic viewer-open path. The authoritative text read also rejects NUL-bearing or invalid UTF-8 content before browser rendering. | Shared-classifier/parser tests with representative eligible and ineligible names, mixed case, compound extensions, and established filenames; route/helper tests with valid text, NUL, and invalid UTF-8 bytes. | Fix both classification and read-time enforcement; do not add per-reference preflight or silently broaden binary/media eligibility. |
| VC-005 | Eligible text at or below 256 KiB is bounded before decoding/rendering; one byte over is rejected, and size/binary failures produce a clear viewer error instead of content. | Exact route/helper boundary tests and viewer tests for size and binary/encoding rejection responses; confirm the configured ceiling is shared rather than duplicated. | Restore authoritative server enforcement and understandable failure handling before closeout. |
| VC-006 | Automatic path candidates that resolve outside the exact session working directory—including absolute paths, `..` traversal, sibling worktrees, and the main checkout from a linked-worktree session—remain inert even if the file API's existing authored-link/session-reference rules could authorize them. Existing authored Markdown link behavior remains unchanged. | Pure containment/parser tests across POSIX, Windows, and UNC forms plus component tests comparing automatic text with authored links; include distinct main/worktree roots and sibling-prefix fixtures. | Treat any automatic out-of-workspace action or authored-link regression as a security blocker. |
| VC-007 | The change passes repository static checks and focused regressions. | `node_modules/.bin/tsc --noEmit`, `npm run lint`, and the affected `.test.mjs` suites. | Correct failures; do not use `next build` for validation. |
| VC-008 | At widths of at least 1000px, an automatic path action directly opens the normal viewer. Below 1000px, activation—not focus—opens one accessible **Open file** confirmation without opening the file; dismissal, focus handling, and stale session/cwd rejection are reliable. Every confirmed agent path, Explorer open, and authored Markdown file open below 1000px then occupies the full application width without browser zoom. Automatic expansion clears on return to desktop, manual desktop expansion survives responsive crossings, narrow restore suppresses re-expansion until another open, and final-tab closure clears both. | Pure responsive-state/component coverage plus manual browser checks for all three file-open origins at 1000px, 999px, 641px, 640px, and a representative phone width using mouse, keyboard, and coarse-pointer emulation; resize across both boundaries, test manual/automatic provenance and restore/close lifecycle, dense transcript text, scrolling, and an in-progress assistant message. | Fix gesture, origin coverage, provenance, breakpoint, accessibility, dismissal, or stale-open behavior; do not substitute long-press, double-tap, browser zoom, or another undiscoverable/browser-conflicting gesture. |
| VC-009 | Automatic recognition remains bounded and fast for long assistant responses and many path-like tokens, with no network/filesystem request until the user confirms or directly activates a file. | Pure-scanner stress test with a bounded synthetic long response and fetch spy/component assertion showing zero recognition-time requests; inspect implementation for linear or equivalently bounded traversal. | Remove eager preflight or replace pathological parsing before closeout. |

## Assumptions, Risks, and Blockers

- False-positive linking is the primary parsing risk; delimited spaces, punctuation, line/column suffixes, and settled-versus-streamed output need explicit fixtures.
- Guard state must not become trapped, open the wrong path after transcript rerender, or conflict with text selection, scrolling, browser context menus, and zoom.
- Automatic/manual expansion provenance must prevent narrow auto-expansion from becoming sticky on desktop or erasing a user's manual desktop expansion.
- Extension/name classification plus NUL and strict-UTF-8 rejection cannot prove semantic text, but any remaining source-named payload is bounded by the existing 256 KiB limit.
- Browser syntax highlighting is not a safe basis for a 10 MiB text ceiling; the existing 256 KiB limit is the current safety evidence.
- No blocker is known.

## Implementation Handoff

After this plan is explicitly approved, start a separate implementation session with:

```text
/start-implementation .agents/plans/2026-08-05-agent-response-file-links.md
```
