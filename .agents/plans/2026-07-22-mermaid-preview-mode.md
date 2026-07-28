# Stable Default Mermaid Preview Mode

Status: approved
Date: 2026-07-22
Approved by user: 2026-07-22

## Objective

Make every completed Mermaid code block render as Preview by default without attempting incremental renders during streaming. Within the mounted session view, the existing single action button is the only control that may change that block between Preview and Source; outside clicks, touches, scrolling, focus changes, unrelated rerenders, and completion reconciliation must preserve the current choice.

Success criteria:

- Streaming Mermaid source remains unrendered and the mode action remains unavailable until that assistant message completes.
- Newly completed, initially loaded, reloaded, and lazy-loaded historical Mermaid blocks automatically enter Preview and generate SVG.
- The existing single action reads **Source** in Preview and **Preview** in Source; only activating it changes mode.
- Manual mode survives ordinary mounted-session interactions and the late entry-ID reconciliation, but reload/session revisit deliberately restores default Preview.
- Invalid Mermaid remains in bounded error Preview with Source access; existing theme, Transcript-size, security, cancellation, natural sizing, and overflow behavior remain intact.

## Evidence and Current State

### Established facts

- Pi Web uses `mermaid@^11.14.0`; this task concerns the existing renderer, not the separately evaluated Beautiful Mermaid package.
- Mermaid syntax is not native HTML and browsers do not parse it themselves. Pi Web dynamically imports the client-side Mermaid JavaScript library, which parses the completed text, computes diagram layout, and returns SVG; the browser then natively displays that SVG.
- `components/MarkdownBody.tsx` recognizes fenced `mermaid` blocks and renders each through `MermaidBlock`.
- `MermaidBlock` currently initializes `showPreview` to `false`, so source is the default. Its one button directly flips that local Boolean and changes its label between `Preview` and `Source`.
- Rendering is currently suppressed while `isStreaming` is true. During streaming the source is shown and the Preview button is disabled; after streaming, preview still does not open automatically because `showPreview` remains false.
- There is no document-level or outside-click handler in `MermaidBlock`. Repository-wide inspection found outside pointer/scroll listeners for scroll intent and panel dismissal, but none call Mermaid view state; the scroll-intent handlers mutate refs rather than React state. An outside interaction is therefore exposing a lifecycle reset, not intentionally toggling Mermaid.
- A deterministic post-stream remount path exists. On `message_end`, `useAgentSession` appends the completed assistant message but does not append its entry ID. On `agent_end`, `loadSession()` reloads history and populates `entryIds`. `AssistantMessageView` keys each content block as `${entryId ?? "stream"}-${originalIndex}`, so the same completed text block changes from a `stream-*` key to an entry-ID key and React must remount its `MarkdownBody` and `MermaidBlock`, resetting `showPreview` to false. This closely matches the reported immediate post-completion reversion, although browser reproduction remains outstanding.
- The authoritative `@earendil-works/pi-ai` `AssistantMessage` type requires a numeric timestamp, and that completed message timestamp is carried in both the `message_end` payload and reloaded session message. It can therefore anchor text-block identity across late entry-ID reconciliation while still distinguishing genuinely different assistant messages.
- The entry-ID block key was added by commit `3b91204` to support deferred historical thinking content. A fix must preserve correct reset/isolation when the user genuinely navigates to a different message or branch; simply deleting identity boundaries without validation could leak thinking or Mermaid state between messages.
- `MarkdownBody` memoizes the `react-markdown` component map with dependencies on `cwd`, `isStreaming`, and `onOpenFile`. The archived wider-chat-column execution record says this fixed a separate remount caused when display preferences changed. The current `onOpenFile` path is callback-memoized for a stable selected session, so ordinary outside clicks should not recreate the map.
- Mermaid output is keyed by source, light/dark theme, and Transcript font size. Existing logic deliberately re-renders for those changes and serializes Mermaid’s global initialize/parse/render operations.
- The current lazy history window mounts the latest 50 rendered chat items initially. Making preview the default for every mounted completed block can therefore enqueue more than one Mermaid operation when a diagram-heavy historical session opens; operations are serialized because Mermaid configuration is global.
- Existing automated coverage consists of server-rendered Markdown link checks in `components/MarkdownBody.test.mjs` and pure render-key/configuration/queue checks in `lib/mermaid-display.test.mjs`. It does not exercise interactive Mermaid mode selection, unrelated rerenders, streaming transitions, remounts, or browser visuals.
- The archived wider-chat-column plan and checkpoint require Mermaid to re-render naturally when Transcript size changes and to retain horizontal overflow. This task must preserve those shipped behaviors.
- The repository has no `.agents/memory/MEMORY.md` index and no maintained `wiki/` pages.
- Local `main` contains unrelated untracked draft plans. They are outside this task and must remain untouched.

### Blocked facts

- The reported sequence is precise: after streaming completes, the user clicks Preview successfully; a slight click, touch, scroll, or page movement outside the rendered block immediately returns it to source. The late entry-ID remount is the strongest source-backed causal path, but direct browser evidence correlating that remount to the report has not been captured during this read-only grill. The deterministic key transition is sufficient to require lifecycle regression coverage rather than assuming the default-state inversion alone fixes the bug.

## Fixed Constraints

- During streaming, Pi Web must not incrementally parse or render incomplete Mermaid source; showing source until completion is acceptable.
- Every mounted completed Mermaid block must automatically preview, including historical diagrams after page reload, when a session opens, or when older messages are mounted. It is acceptable and expected to generate fresh SVG after a reload rather than persist the prior DOM; implementation must avoid incremental streaming renders and validate bounded multi-diagram history behavior.
- A preview that the user opened manually must remain open until the user uses that same block’s mode control; automatic Preview is required rather than conditional.
- Clicking a block’s Source control must show that block’s source.
- A failed automatic or manual render must remain in Preview mode with the bounded error state and an explicit Source control; failure must not automatically switch modes.
- No click, touch, scroll, page movement, focus change, or interaction outside that block’s explicit mode control may toggle or reset its view while the session view remains mounted.
- A deliberate Source or Preview selection remains stable for the current mounted session view. Reloading or switching away and back creates completed blocks in default Preview again; no per-diagram browser persistence is required.
- Each Mermaid block’s selection must be independent of other Mermaid blocks.
- Existing Mermaid security configuration, theme handling, Transcript-size re-layout, stale-result cancellation, error diagnostics, natural SVG sizing, and horizontal overflow must not regress.
- This grill may mutate only this plan. Source, tests, configuration, wiki, memory, checkpoints, runtime state, worktrees, and commits remain out of scope until a later explicit implementation opening.
- Repository validation must not run `next build` during development.

## Scope and Non-Goals

### In scope

- Default preview/source state for Mermaid blocks in rendered chat Markdown.
- Explicit mode-control semantics and accessible labeling.
- Stability across the lifecycle boundaries selected during this grill.
- Streaming-completion and render-failure behavior selected during this grill.
- Focused automated and realistic browser validation of the selected behavior.

### Non-goals

- Replacing Mermaid or adopting Beautiful Mermaid.
- Redesigning Markdown rendering, ordinary fenced code blocks, or the file viewer’s Markdown/source toggle.
- Changing Mermaid syntax support, diagram themes, layout algorithms, Transcript-size behavior, or SVG sizing.
- Adding server APIs, account/session synchronization, or content-bearing telemetry.
- Preserving view state across boundaries the user explicitly excludes during this grill.

## Decisions and Open Questions

### Resolved decisions

| ID | Decision | Authority / rationale | Consequences |
|---|---|---|---|
| D-001 | Rendered preview is the default view for completed Mermaid blocks. | Explicit user requirement on 2026-07-22. | Initial component behavior must invert from source-first to preview-first. |
| D-002 | Only an explicit control on the specific Mermaid block may change that block’s selected view. | Explicit user requirement on 2026-07-22. | Outside clicks, parent rerenders, theme/font changes, and unrelated UI state must not act as view toggles. |
| D-003 | Source selection is independent per Mermaid block. | Required by “that specific button” and the existing per-block UI model. | No global all-diagrams toggle is introduced. |
| D-004 | Do not parse or render Mermaid incrementally while a response is streaming; source may remain visible until completion. | User clarification on 2026-07-22. | Avoids repeated invalid parses and render churn from incomplete source. |
| D-005 | After a response completes, automatically preview all of its Mermaid blocks. | User preference on 2026-07-22. | Completion establishes initial Preview but never overrides a later explicit Source selection in the mounted view. |
| D-006 | Preventing the selected mode from reverting on outside click/touch/scroll is a P0 requirement independent of default mode. | Explicit user priority on 2026-07-22. | A default-state inversion alone is insufficient; lifecycle resets must be fixed. |
| D-007 | Automatically preview every mounted completed Mermaid block, including historical diagrams. | User accepted the recommendation on 2026-07-22. | New completions, initial history, page reloads, and older messages mounted through lazy loading use the same preview-first behavior; multi-diagram load cost requires validation. |
| D-008 | “Stay rendered after reload” means completed history automatically renders fresh SVG in Preview again; preserving the old DOM/SVG instance is unnecessary. | User clarification plus browser/React lifecycle facts on 2026-07-22. | No SVG cache or persisted preview flag is needed to satisfy default Preview across reloads. |
| D-009 | Manual Source/Preview selection lasts for the current mounted session view; reload or session revisit returns completed blocks to default Preview. | User confirmed the recommended lifecycle on 2026-07-22. | Ordinary interactions and completion reconciliation cannot reset mode; no localStorage, server state, or cross-session mode cache is introduced. |
| D-010 | A Mermaid parse/render failure remains in the error Preview until the user explicitly selects Source. | User decision on 2026-07-22. | Failure never acts as an automatic mode toggle; retain bounded diagnostics and source access. |
| D-011 | Retain the existing single destination-action button: Source while in Preview, Preview while in Source. | User confirmation on 2026-07-22. | No segmented control or global diagram control is added; the button requires accurate accessible naming and visible focus. |

### Open questions

None. The following alternatives are explicitly excluded: incremental streaming renders, source-first completed blocks, outside-click dismissal, automatic source fallback on errors, cross-reload manual-mode persistence, two-button/segmented controls, and a global all-diagrams mode.

### Glossary

| Term | Kind | Where | What it does | State/lifetime |
|---|---|---|---|---|
| Mermaid block | UI component | `MermaidBlock` in `components/MarkdownBody.tsx` | Represents one fenced `mermaid` source block as either source or rendered SVG. | Exists while React keeps that Markdown block mounted. |
| Preview view | UI state | `MermaidBlock` | Shows loading, rendered SVG, or a bounded render-error state. | Currently opt-in; intended to become the completed-block default. |
| Source view | UI state | `MermaidBlock` / `CodeBlock` | Shows syntax-highlighted Mermaid text and Copy action. | Currently the default; intended to become explicitly selected. |
| Rerender | React lifecycle | Markdown/message tree | Re-evaluates mounted components while normally retaining local state. | Frequent during UI state updates. |
| Remount | React lifecycle | Markdown/message tree | Destroys and recreates a component, resetting unpersisted local state. | Can occur when component type or key identity changes or content leaves the mounted tree. |
| Streaming | Message lifecycle | `MarkdownBody.isStreaming` | Indicates that assistant output is still changing and Mermaid source may be incomplete. | Ends when the current assistant message completes. |
| SVG | Browser graphic format | Mermaid render output / DOM | Encodes the finished diagram as browser-renderable vector elements after Mermaid parses and lays out its source. | Generated client-side for a mounted completed block; regenerated after reload. |

### Touched-surface classification

- `ui/frontend`: Mermaid default view, explicit controls, streaming/lifecycle behavior, accessibility, and visible error state.
- `telemetry/debuggability`: retain existing bounded render-stage/error-name attributes; new production telemetry is **not applicable**.
- `configuration`: **not applicable**; no browser, session, project, or server persistence is selected.
- `docs/current-state`: **not applicable**; the repository has no maintained Mermaid UI documentation or wiki, and this narrow interaction change does not alter setup or public API documentation.
- `privacy/auth`: no content, SVG, session identifier, or path may be logged or transmitted.

## Design / Implementation Strategy

1. Replace the preview Boolean with explicit local view selection whose effective behavior is: Source while `isStreaming`; otherwise the user’s current selection, defaulting to Preview. Keep the action disabled during streaming. This lets the existing `message_end` transition start rendering a complete message without parsing token-by-token updates.
2. Keep mode selection separate from render freshness. Theme or Transcript-size changes invalidate and regenerate SVG through the existing render key while preserving Source/Preview selection. A code/message identity change creates a new default-Preview block rather than inheriting another block’s selection.
3. Stabilize completed text/Markdown block identity across the known `entryId` transition from absent at `message_end` to present after `agent_end` reload. Use an immutable completed-message identity already present in both representations (the assistant timestamp plus original block position) rather than the late entry ID for the text block’s React identity.
4. Preserve deferred-thinking isolation from commit `3b91204`: continue using session/entry/block identity for deferred content fetching and resetting thinking-specific state. Do not let the Mermaid fix cause expanded/loading thinking state to leak across branch or message changes.
5. Keep the memoized `react-markdown` component map and ensure its renderers do not capture stale `cwd`, `onOpenFile`, or streaming values. Verify that hover, scroll, panel, theme, Transcript-size, and parent reconciliation rerenders preserve each Mermaid block’s mode.
6. On completed mount—including initial history, page reload, session revisit, and older lazy-loaded messages—start Preview rendering immediately. Regenerate SVG after each mount; do not persist SVG or manual mode in localStorage, server/account state, or a cross-session cache.
7. Preserve the existing serialized Mermaid operation queue, dynamic import, `securityLevel: "strict"`, suppressed Mermaid error rendering, cancellation guard, source/theme/Transcript render key, natural-width restoration, loading/error diagnostics, and horizontal overflow. A failed operation remains bounded error Preview and must not poison later queued renders.
8. Retain one per-block destination-action button and existing Copy behavior in Source. Give the action accurate title/accessible text, keyboard activation, and visible focus; do not add outside-click handlers.
9. Keep each block independent. Internal React identities and validation diagnostics must not log, persist, or expose Mermaid source, generated SVG, transcript content, session IDs, or file paths.

## Test Strategy

- Add isolated tests for the mode/identity decisions in a pure helper boundary: streaming suppresses Preview, completed blocks default to Preview, explicit selection wins while mounted, the provisional-to-final entry-ID transition keeps completed text identity stable, and a genuinely different completed message does not reuse identity.
- Streaming-transition coverage proving source remains unrendered during streaming, completed diagrams automatically preview, and a later explicit selection is never overridden.
- Multiple-block coverage proving independent selection.
- Theme and Transcript-size rerender coverage proving SVG refresh without mode reset.
- Render-failure coverage proving the bounded error remains in Preview and only the explicit Source control reveals code.
- Public-surface browser validation: verify automatic Preview for a new completion and historical diagrams; select Source, then click/touch outside, hover, focus another control, scroll normally and through the minimap, open/close panels, and change theme/Transcript size. The block must remain Source until its own action returns it to Preview.
- Exercise the exact reconciliation boundary: select a mode after `message_end`, allow `agent_end` history reload to supply the entry ID, and prove the choice does not reset or flash to the other mode.
- A non-sensitive bounded historical fixture with multiple valid diagrams plus one invalid diagram must prove all valid blocks settle, the invalid block remains error Preview, interaction remains operable while renders queue, and a failure does not poison later diagrams.
- Reload and session revisit must prove completed blocks regenerate Preview; preserving a prior manual Source choice across those boundaries is explicitly not expected.
- Regression suite: `node --test components/*.test.mjs lib/*.test.mjs`, `node_modules/.bin/tsc --noEmit`, `npm run lint`, and `git diff --check`. `next build` is prohibited.
- Visual evidence is required for the user-visible toggle behavior. If browser automation cannot safely access a Mermaid fixture, record that blocker and require focused user testing rather than silently waiving it.

## Telemetry / Debuggability

- New production telemetry is **not applicable**: this is local deterministic presentation state, and the expected failure is directly observable in the UI.
- Preserve the existing low-cardinality `data-mermaid-render-stage`, `data-mermaid-error-stage`, and `data-mermaid-error-name` diagnostics.
- Do not log Mermaid source, generated SVG, transcript text, session identifiers, file paths, user labels, or raw errors that may echo source.
- Browser validation may inspect mode labels, bounded data attributes, and element presence without recording content.

## Validation Contract

| ID | Priority | Type / surface | Required truth | Required evidence | Validator mode | Blocker / waiver path |
|---|---|---|---|---|---|---|
| VC-001 | P0 | UI / default mode | Every mounted completed valid Mermaid block opens in rendered preview without requiring a Preview click, including new completions and historical messages. | Focused component assertions plus browser evidence on safe live-completion and multi-diagram history fixtures. | scrutiny + user-testing | No waiver; failure blocks completion. |
| VC-002 | P0 | UI / explicit selection | Selecting Source keeps that block in source through every ordinary interaction and completion-reconciliation rerender in the mounted session; only its own control changes it back. Reload or session revisit deliberately restores default Preview. | Interaction test and browser sequence covering outside clicks, scroll/touch, relevant rerenders, reload, and session revisit. | scrutiny + user-testing | No waiver for mounted-session stability; cross-reload Source persistence is explicitly not applicable. |
| VC-003 | P0 | UI / independent blocks | Changing one Mermaid block’s view does not change another block. | Multi-block interaction evidence. | scrutiny | No waiver. |
| VC-004 | P0 | UI / render lifecycle | Theme, Transcript size, source freshness, and streaming completion follow the resolved behavior without stale SVG or silent mode reset. | Focused lifecycle tests plus browser inspection of mode and render key effects. | scrutiny + user-testing | A lifecycle boundary may be excluded only by explicit user decision with rationale. |
| VC-005 | P1 | UI / errors and accessibility | Invalid diagrams remain in bounded error Preview without an automatic source fallback; the single destination-action is accurately named, keyboard operable, and visibly focusable. | Component/browser error fixture, explicit Source/Preview interaction, and accessibility inspection. | scrutiny | If an error fixture is unavailable in the live app, a synthetic non-sensitive fixture is required. |
| VC-006 | P1 | Regression / existing Mermaid behavior | Strict rendering, serialized operations, natural Transcript-size re-layout, cancellation, natural SVG width, horizontal scrolling, and deferred-thinking isolation are preserved. | Existing helper tests, focused identity/queue additions, source scrutiny, and safe browser geometry where affected. | scrutiny | No waiver for security, cancellation, or thinking-state isolation; geometry may be blocked only with explicit user validation required. |
| VC-007 | P1 | Static / repository | Focused tests, full Node suite, TypeScript, lint, and diff checks pass; no server API, renderer replacement, or content telemetry is added. | Command output and diff review. | scrutiny | No waiver; failures block closeout. |
| VC-008 | P1 | Execution state | The implementation checkpoint records decisions, command outcomes, browser evidence, user results, commits, and closeout state. | Completed checkpoint review. | scrutiny | No waiver for implementation with saved execution state. |
| VC-009 | P1 | UI / bounded workload | Automatic Preview on a multi-diagram historical view completes all valid queued renders, keeps controls operable, and allows an invalid render without blocking later diagrams. | Browser fixture with multiple valid diagrams and one invalid diagram, bounded stage/outcome inspection, interaction during the queue, and zero browser error events. | scrutiny + user-testing | If automation cannot host a safe fixture, record the blocker and require focused user testing before closeout; do not claim workload validation from unit tests alone. |

## Assumptions, Risks, and Blockers

### Assumptions

- “Always preview” means the initial state after response completion and never permission to parse incomplete streaming fragments.
- The report concerns Mermaid blocks in chat Markdown, not Markdown file previews or ordinary code blocks.
- Page reload necessarily rebuilds the React/DOM tree, but default Preview plus fresh client-side Mermaid rendering satisfies the requested visible result without preserving DOM nodes.
- The current user-visible reset is real even though the exact triggering lifecycle path remains to be reproduced.

### Risks

- Simply changing `useState(false)` to `useState(true)` would mask the reported Preview-to-Source reset but would make the same remount silently override an explicit Source selection, violating the broader requirement.
- Automatically rendering every mounted historical diagram could create a long serialized queue on a diagram-heavy session; the latest-50-item lazy window bounds but does not eliminate this cost.
- Persisting state too broadly could make stale choices survive content replacement or navigation in surprising ways; cross-reload/session persistence is therefore explicitly excluded.
- Parsing on every streaming token can create repeated invalid states, queue expensive work, and display stale diagrams.
- A render failure must not poison Mermaid’s serialized operation queue or prevent later valid diagrams from rendering; the selected bounded error Preview avoids an unsolicited mode change.
- Making `react-markdown` renderers globally stable must not capture stale `cwd`, `onOpenFile`, or `isStreaming` values.

### Blockers

- No technical or product blocker is known. The plan is approved, but implementation remains unopened until the user issues the exact handoff command below.

## Implementation Handoff

Approved plan path: `.agents/plans/2026-07-22-mermaid-preview-mode.md`

```text
Open up implementation for .agents/plans/2026-07-22-mermaid-preview-mode.md
```

Approval does not authorize implementation; only that later explicit command opens the required non-main worktree and matching checkpoint.
