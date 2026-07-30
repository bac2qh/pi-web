# Responsive Mermaid Preview Sizing

Status: approved
Date: 2026-07-29
Approved by user: 2026-07-29

## Objective

Make each completed Mermaid preview enter the DOM at its final shrink-to-fit geometry: a diagram narrower than the preview panel remains at its natural width, while a wider diagram shrinks to the panel width without changing aspect ratio.

Success requires:

- Small diagrams are never enlarged merely to fill available space.
- Large diagrams fit within the panel’s content width and preserve their viewBox aspect ratio.
- Every generated SVG, including one regenerated after completion settlement or a display-preference change, has the responsive sizing contract before it is inserted into the visible preview.
- No post-mount application code rewrites the SVG between fixed and responsive width.
- Existing streaming, Preview/Source, error, theme, Transcript font-size, reload, strict-rendering, cancellation, and queue behavior remains intact.

## Design / Implementation Strategy

1. At the successful `result.svg` boundary in `MermaidBlock`, prepare the SVG before `setSvg()` rather than mutating the visible DOM afterward. Read the root SVG viewBox and accept only a finite positive natural width.
2. For a valid viewBox, finalize the root SVG as shrink-only responsive before publication: `width: 100%`, `max-width: <natural viewBox width>`, and `height: auto`. Preserve the viewBox, aspect-ratio behavior, accessibility metadata, generated IDs, descendant markup, unrelated root attributes, and unrelated inline styles.
3. Use a detached browser parser/element for root-SVG modification rather than broad regular-expression replacement. Add no parsing or DOM dependency solely for this task. Keep any numeric viewBox parsing or sizing-policy helper pure and isolated when useful for Node tests; validate the actual SVG transformation in a browser.
4. Make finalization idempotent so a remount or repeated preparation cannot accumulate or change sizing metadata. If the SVG lacks a valid positive viewBox width, preserve Mermaid’s output rather than inventing dimensions; retain panel overflow as a defensive fallback for that case.
5. Remove `MermaidBlock`’s post-insertion `useLayoutEffect`, its preview DOM ref, and the fixed pixel-width/`max-width: none` mutation. The visible SVG’s first state must already be final.
6. Remove the Mermaid CSS rule that forces `max-width: none`. Retain `display: block`, panel padding/background, and defensive horizontal overflow. Do not add an unconditional full-width rule without the natural maximum, because that would enlarge small diagrams.
7. Do not change completion folding, SVG ownership, or Preview/Source selection ownership. Completion settlement may still regenerate an SVG, but each generated instance must be inserted with the same responsive contract. If realistic validation shows different viewBoxes for identical inputs or a residual visible replacement shift, stop and report that evidence rather than silently adding an SVG cache or restructuring message folding.
8. Preserve Mermaid’s serialized initialize/parse/render queue, dynamic import, `securityLevel: "strict"`, suppressed library error output, stale-result cancellation, bounded error diagnostics, and source/theme/Transcript render key.

**Rough scope estimate:**

- **Surfaces:** `components/MarkdownBody.tsx`, `app/globals.css`, a small sizing/finalization helper in `lib/mermaid-display.ts` if useful, focused tests, and privacy-safe browser validation through the existing chat lifecycle.
- **Testability:** High for viewBox interpretation, output attributes/styles, and fallback behavior; browser geometry and first-insertion evidence are required for the visible contract.
- **Implementation complexity:** Small to moderate. The production change is narrow; realistic validation must cover panel widths and completion remounts without adding a browser-test dependency.

## Reference Files

- [`components/MarkdownBody.tsx`](../../components/MarkdownBody.tsx) — Mermaid rendering, SVG insertion, and current post-mount fixed-width normalization.
- [`lib/mermaid-display.ts`](../../lib/mermaid-display.ts) — Mermaid mode, queue, font configuration, and render-key helpers; likely home for a small pure sizing helper.
- [`app/globals.css`](../../app/globals.css) — Mermaid panel overflow and the CSS rule currently defeating responsive shrinking.
- [`components/MarkdownBody.test.mjs`](../../components/MarkdownBody.test.mjs) — existing completed/streaming/multiple-block markup coverage.
- [`lib/mermaid-display.test.mjs`](../../lib/mermaid-display.test.mjs) — existing pure Mermaid mode, render-key, font, and queue coverage.
- [`components/ChatWindow.tsx`](../../components/ChatWindow.tsx) — mounted-session Preview/Source ownership and live-versus-settled message structure used in lifecycle validation.
- [`hooks/useAgentSession.ts`](../../hooks/useAgentSession.ts) — `message_end`/`agent_end` ordering and reload boundary used in realistic validation.
- [`.agents/checkpoints/2026-07-22-mermaid-preview-mode-checkpoints.md`](../checkpoints/2026-07-22-mermaid-preview-mode-checkpoints.md) — prior fake-SSE/browser validation approach and evidence that SVG state can regenerate across settled folding.

## Constraints and Scope

### Fixed constraints

- Never parse or render partial Mermaid while an assistant response is streaming.
- Completed and historical Mermaid blocks default to Preview; only the block’s own Source/Preview action changes its mode.
- Invalid Mermaid remains in bounded error Preview with Source available.
- Small diagrams remain at natural size; large diagrams shrink to panel width; aspect ratio is preserved.
- Theme and Transcript font-size changes continue to regenerate layout using the existing render key.
- Generated source, SVG markup, transcript content, session identifiers, paths, and raw payloads must not be logged or retained as validation output.
- Preserve unrelated repository changes. Do not add dependencies and do not run `next build` during development validation.

### In scope

- Final responsive sizing of Mermaid’s returned SVG before visible insertion.
- Removal of the post-mount fixed-width rewrite and conflicting Mermaid CSS.
- Safe fallback for output without a usable viewBox.
- Focused helper/component regression tests and realistic geometry/lifecycle validation.

### Out of scope

- Replacing Mermaid, changing diagram syntax/layout algorithms, or adopting Beautiful Mermaid.
- Stretching small diagrams to full panel width.
- Caching SVG across remounts or redesigning live/settled message folding unless separately approved after evidence shows final pre-insertion sizing is insufficient.
- Changing Preview/Source persistence, server APIs, settings, account/session synchronization, or production telemetry.
- Removing panel overflow entirely; it remains a fallback for unsupported output.

### User-authorized behavior change

On 2026-07-29, the user selected shrink-only responsiveness: small diagrams stay at natural size, large diagrams shrink to the panel, and aspect ratio remains intact. For valid viewBox output, this supersedes the prior fixed-natural-width/horizontal-scroll behavior; horizontal overflow remains only a defensive fallback when output cannot be safely normalized.

## Evidence and Current State

### Established facts

- `components/MarkdownBody.tsx` dynamically imports Mermaid, serializes initialize/parse/render work, receives `result.svg`, and stores that string for `dangerouslySetInnerHTML`.
- Installed Mermaid 11.15 commonly emits `width="100%"` plus a computed natural `max-width` when a renderer uses `useMaxWidth`; other renderer paths can emit fixed width and height.
- Pi Web currently inserts Mermaid’s result and then runs `useLayoutEffect` to force width equal to the viewBox width in pixels, `height: auto`, and `max-width: none`, with inline `!important` declarations.
- `app/globals.css` separately forces `.mermaid-block svg { max-width: none !important; }`. These two application overrides intentionally prevent large diagrams from shrinking.
- Existing server-rendered component tests cover Preview-first, streaming Source, and multiple independent blocks, but they do not import Mermaid, run effects, inspect final SVG, or measure geometry.
- Existing pure tests cover view-mode semantics, render-key freshness, bounded font configuration, and queue recovery; they do not cover SVG sizing.
- Live completion can remount/reparent completed text during settled process/final-answer folding. Preview/Source selection is lifted into `ChatWindow`, but SVG state remains local and is regenerated after such a remount.
- Repository CSS contains no Mermaid width transition or animation, and no application observer targets Mermaid sizing.

### Blocked facts

- The user-visible delayed resize has not yet been correlated with one exact browser lifecycle event. This does not block the selected responsive contract, but implementation validation must distinguish element replacement from same-element geometry mutation and verify that every inserted replacement is already finalized.

## Test Strategy

### Focused automated coverage

- Add pure tests for valid, decimal, missing, malformed, zero, negative, and non-finite viewBox widths and the preserve-original fallback.
- Prove the responsive sizing policy produces `width: 100%`, natural pixel `max-width`, and `height: auto` without rounding away meaningful decimal width.
- Prove finalization is idempotent and preserves unrelated root attributes/styles. Do not snapshot or print complete SVG markup.
- Retain existing tests proving completed Preview, streaming Source without rendering, independent blocks, theme/font/source render-key freshness, strict configuration inputs, and rejection-safe queueing.
- If the browser-only parser prevents a truthful Node transformation test, keep Node coverage at the pure viewBox/policy boundary and require the browser public-surface evidence below; do not add a DOM test dependency merely to improve test shape.

### Browser/public-surface coverage

Use privacy-safe synthetic fixtures and an isolated development port; do not use a private session, real provider, or the existing port 30141 process.

- Small diagram in a wide panel: rendered width approximately equals natural viewBox width and remains below available content width.
- Large diagram in a narrow panel: rendered width approximately equals the available content width and remains below natural width.
- In both cases, rendered width/height ratio approximately matches the viewBox ratio.
- Narrow and widen the panel: the large diagram follows available width, while widening stops at natural width and never upscales a small diagram.
- Observe anonymous SVG instances at insertion and for a bounded interval: root sizing is already responsive at first observation and application code performs no later width/style rewrite.
- Exercise initial Preview, Source-to-Preview, theme change, non-default Transcript font size, reload/history, and the real `message_end` to `agent_end` settled-fold/remount path; every replacement must begin with the same sizing contract.
- Sample representative renderer families: flowchart, sequence, one class/state/ER family, and one non-graph family such as pie or mindmap. A missing valid viewBox must use the documented preserve-output/overflow fallback.
- Invalid Mermaid remains bounded error Preview with Source access and no browser/console errors beyond the expected handled render failure.

### Regression commands

- `node --test components/MarkdownBody.test.mjs lib/mermaid-display.test.mjs`
- `node --test components/*.test.mjs lib/*.test.mjs`
- `node_modules/.bin/tsc --noEmit`
- `npm run lint`
- `git diff --check`
- `next build` is prohibited.

## Telemetry / Debuggability

New production telemetry is not applicable: this is deterministic local presentation behavior, and content-bearing logging would create unnecessary privacy risk. Preserve existing bounded render-stage and error-stage/name data attributes.

Browser validation may temporarily observe only elapsed time, anonymous in-memory element ordinal, connected/replaced state, width/max-width/height declarations, viewBox dimensions, panel/SVG bounding dimensions, theme Boolean, and effective Transcript size. Do not record source, serialized SVG, generated IDs, session data, file paths, or raw event payloads. Remove temporary instrumentation before final review.

## Validation Contract

1. **VC-001 — P0, browser geometry and sizing policy.** A valid small diagram is not enlarged; a valid oversized diagram shrinks to the panel; both preserve viewBox aspect ratio across panel resizing. Evidence: bounded browser geometry for wide and narrow panels plus pure sizing-policy tests. Validator mode: scrutiny and user-testing. No waiver; failure blocks completion.
2. **VC-002 — P0, first visible SVG state.** Every successful SVG instance—including completion/remount, Source-to-Preview, theme, and Transcript-size replacements—has final shrink-only responsive sizing before visible insertion, with no later application width/style rewrite or fixed-to-responsive flash. Evidence: privacy-safe insertion/mutation trace and visual browser evidence on the real chat lifecycle. Validator mode: scrutiny and user-testing. No waiver; a residual different-viewBox replacement requires stopping and reporting rather than expanding into caching/folding work.
3. **VC-003 — P0, existing Mermaid interaction lifecycle.** Streaming remains unrendered Source; completed/history blocks default Preview; only their own action changes mode; invalid diagrams remain bounded error Preview; reload and settled folding preserve the previously approved behavior. Evidence: existing and focused automated tests plus browser interaction/lifecycle pass. Validator mode: scrutiny and user-testing. No waiver.
4. **VC-004 — P1, renderer-family and fallback compatibility.** Representative graph and non-graph renderers satisfy the sizing contract when they expose a valid viewBox; missing or invalid natural geometry preserves Mermaid output and defensive overflow without corruption. Evidence: pure malformed-input cases and browser samples across the selected renderer families. Validator mode: scrutiny. A family without valid geometry may use the documented fallback; inventing dimensions is not allowed.
5. **VC-005 — P1, SVG integrity and security.** Responsive finalization preserves viewBox, accessibility metadata, generated identifiers, descendants, and unrelated root attributes/styles; strict Mermaid rendering, cancellation, and serialized queue recovery remain unchanged. Evidence: focused preservation/idempotence tests, source review, existing queue/config tests, and zero unexpected browser errors. Validator mode: scrutiny. No waiver for security, cancellation, or markup corruption.
6. **VC-006 — P1, privacy and repository regression.** No content-bearing telemetry or dependency is added; focused/full Node tests, TypeScript, lint, and diff checks pass; no unrelated changes are touched and `next build` is not run. Evidence: final diff/status review and command output. Validator mode: scrutiny. No waiver for failing required checks.

## Assumptions, Risks, and Blockers

### Assumptions

- “Fit the width naturally” means shrink-only behavior, not stretching every diagram to the panel width.
- A positive finite viewBox width is the authoritative natural maximum for application finalization.
- Replacing one finalized SVG with an equivalently finalized SVG is acceptable when no geometry flash occurs; preserving DOM identity is not itself a product requirement.

### Risks

- Mermaid renderer families differ in their raw width/height styles, so finalization must operate on the root viewBox rather than trust only one renderer’s `useMaxWidth` output.
- Detached parsing/serialization could damage unusual SVG markup if implemented carelessly; preservation tests and representative browser renderers are required.
- HTML labels and font availability can influence Mermaid’s computed viewBox. Validation should wait for fonts and distinguish a legitimate theme/Transcript re-layout from a post-mount sizing rewrite.
- Initial display-preference hydration could still trigger a separate rerender. If it causes a visible shift after pre-insertion sizing is correct, that is evidence for a separate hydration scope decision rather than authority to broaden this plan.

### Blockers

None currently known.

## Implementation Handoff

After approval, start implementation with:

```text
/start-implementation .agents/plans/2026-07-29-responsive-mermaid-sizing.md
```
