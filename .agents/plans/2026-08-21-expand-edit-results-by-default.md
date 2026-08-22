# Expand Edit Results by Default

Status: approved

## Objective

Make edit tool activity open by default in the chat transcript and give its changed-hunk presentation a polished, intentionally pleasing review-card design, while preserving the user's ability to collapse and reopen it.

Success means:

- recognized edit tool calls with a paired result start expanded and show their structured patch or fallback result;
- users can still collapse and re-expand each edit independently;
- non-edit tool calls keep their current default;
- edit failures and edit results without structured patch data remain understandable and do not disappear; and
- structured edit patches use a visually polished code-review style with clear hierarchy, balanced density, theme-appropriate contrast, and readable code at narrow and wide chat widths.

Completed turns containing a recognized edit must also open their outer **Process details** group by default so the edit remains visible after the turn settles. Users can still collapse that group. Structured patches must emphasize only the changed hunks in a full-width top-to-bottom presentation; side-by-side comparison is excluded.

## Design / Implementation Strategy

### Scope estimate

- **Surfaces:** browser transcript and patch rendering in `components/MessageView.tsx`; dedicated diff styling in `app/globals.css`; completed-turn grouping in `components/ChatWindow.tsx`; a shared edit-name/display helper; the parsed hunk model in `lib/patch.ts`; focused parser, display-helper, and component tests.
- **Testability:** high for disclosure behavior and structural diff rendering. Visual polish, theme contrast, rhythm, dense code readability, and responsive layout require deliberate browser screenshots/checks at representative narrow and wide chat widths.
- **Implementation difficulty:** medium to high. The default-open behavior is local, while a polished review-card treatment adds syntax presentation, responsive layout, theme, and visual regression risk. This is a material increase from the original behavior-only request but remains one coherent transcript-edit outcome.

### Disclosure behavior

Reuse the existing edit-tool recognition and paired-result seam. Move or export the recognition policy once so `MessageView`, completed-turn classification, and tests cannot drift. Initialize a recognized edit card from `expanded`, while non-edit cards remain collapsed. Keep later toggles as mounted component state so an explicit collapse remains authoritative until that card remounts. Add complete native disclosure semantics (`type="button"`, state-specific accessible name, `aria-expanded`, `aria-controls`, visible focus, and a controlled body) without changing tool execution or result data.

Give the outer completed-turn disclosure an edit-aware initial state while preserving manual collapse and leaving turns without edits collapsed. Derive whether the exact grouped display blocks contain a recognized edit and pass that fact into the existing group rather than moving or duplicating blocks. Opening the existing group also reveals thinking and other tool activity from that turn; this is the accepted consequence of preserving the established process grouping.

### Change-focused patch model

Keep the authoritative `details.patch`/`details.diff` strings immutable and make no session, transport, tool, or server change. Replace the split-specific browser parse model with files containing explicit hunks and ordered unified rows carrying old/new line numbers. Preserve file paths, hunk ranges, additions, deletions, replacements, and no-newline markers.

Within each parsed hunk, identify contiguous changed runs, retain the union of exactly three available context rows before and after each run, and represent larger omitted gaps with their actual unchanged-line count. Nearby changes whose context windows overlap remain one visual group without duplicated context. Render malformed or nonstandard patch text through a safe, readable plaintext fallback rather than guessing structure.

### Selected visual direction

Replace the current two-column comparison with a full-width, top-to-bottom changed-hunk presentation. The transcript should lead with what changed rather than reproduce an editor or whole-file review surface:

- group output by changed file and hunk;
- keep the file path and enough location information to orient the user;
- retain exactly three adjacent unchanged lines before and after each contiguous change for orientation, while omitting the rest of each unchanged region;
- present removed content above added content at the full chat-column width, with clear theme-aware red/green treatment and old/new line numbers;
- apply restrained syntax coloring based on the changed file's existing language mapping, dim unchanged context, and place a stronger nested highlight only on the exact changed text within paired removed/added rows; when exact pairing is ambiguous, keep the whole-row cue without inventing an intra-line match;
- soft-wrap long code within the card, aligning continuation text under the code with an empty continuation gutter and no horizontal scrolling in either the page or card;
- let the expanded card grow naturally with its changed hunks and use only the main transcript scroll—no fixed maximum height or nested vertical scrollbar; and
- separate multiple hunks compactly so each change remains scannable.

Use the existing file-language mapping and `react-syntax-highlighter` dependency; add no package. Highlight a hunk as a coherent code block so multiline syntax state is retained, then merge diff-row and reliable intra-line annotations without changing or interpreting code as HTML. Bound expensive syntax/intra-line work and fall back to the same truthful plaintext rows for oversized or pathological input.

Move the polished treatment to semantic CSS classes rather than expanding the current inline-style block. A successful structured edit uses a neutral, theme-aware shell so red/green are reserved for the actual deletion/addition hierarchy; errors retain a clear red state. The disclosure/file header should show the path, compact addition/deletion totals, duration when available, and collapse state without duplicating a single-file path. Multiple files receive distinct compact headers. Use textual `−`/`+` markers and line numbers as well as color, subdued context, rounded but restrained borders, and balanced spacing in both themes.

This direction borrows the compact hierarchy of GitHub/Codex review cards but explicitly excludes split view at every breakpoint, full-file reproduction, context-expansion controls, comments, staging, reverting, Viewed state, repository diff scope, and other review-product behavior. Do not add persistence, a global setting, a new generic disclosure framework, review actions, or special handling for unrelated tool names.

## Reference Files

- [Repository architecture and transcript behavior](../../AGENTS.md)
- [Tool-call disclosure, edit recognition, and patch/result rendering](../../components/MessageView.tsx)
- [Completed-turn Process details grouping](../../components/ChatWindow.tsx)
- [Application theme variables and responsive styling](../../app/globals.css)
- [Assistant block classification helpers](../../lib/message-display.ts)
- [Display helper tests](../../lib/message-display.test.mjs)
- [Unified patch parser and split-row model](../../lib/patch.ts)
- [Unified patch parser tests](../../lib/patch.test.mjs)
- [Existing file-viewer unified diff and syntax treatment](../../components/FileViewer.tsx)
- [Existing transcript syntax treatment](../../components/MarkdownBody.tsx)
- [Transcript Markdown and MessageView render tests](../../components/MarkdownBody.test.mjs)
- [File-path language mapping](../../lib/file-types.ts)
- [Normalized tool message types](../../lib/types.ts)

## User Decisions, Current Evidence, and Constraints

- **User decision — completed-turn visibility:** when a completed turn contains a recognized edit, both the outer **Process details** group and the edit card start expanded. The existing group may consequently reveal the turn's other process activity; users retain both collapse controls.
- **User decision — change-focused vertical layout:** do not use split view. Show changed hunks at full width in top-to-bottom order, with removed content above added content, instead of presenting the entire file. Retain exactly three unchanged context lines before and after each contiguous change and omit the remaining unchanged regions.
- **User priority — visual quality:** treat the diff as a designed transcript surface, not a minimally styled patch. Spacing, hierarchy, code treatment, color, borders, and light/dark presentation must be intentionally pleasing as well as functional.
- **User decision — long lines:** soft-wrap long code inside the full-width card. Continuation rows align beneath the code with an empty line-number gutter; do not introduce horizontal page or nested diff scrolling.
- **User decision — layered code styling:** use restrained syntax highlighting, soft red/green whole-row cues, stronger emphasis on exact changed text where a removed/added pairing is reliable, and dimmed unchanged context. Ambiguous pairings must remain whole-row-only rather than showing a misleading intra-line match.
- **User decision — card height:** an expanded edit card grows naturally with all of its changed hunks and participates in the main transcript scroll. Remove the current patch-height cap and do not add nested vertical scrolling or another show-more disclosure; the existing edit-card collapse remains the escape hatch.
- `ToolCallBlock` currently initializes every tool card with `useState(false)`.
- The same component already identifies edit tools through `isEditToolName(...)`; this is the narrowest existing seam for changing only edit defaults.
- Successful paired results prefer `details.patch`, then `details.diff`, and otherwise fall back to the ordinary text result. Edit failures intentionally bypass structured patch rendering. The installed Pi edit tool generates the standard unified patch with four unchanged context lines around each hunk, so Pi Web can trim presentation context without changing tool execution or transport data.
- Once a turn settles, `ChatWindow` moves process blocks—including edit calls—under a distinct `ProcessDetailsGroup`, which also initializes with `useState(false)`.
- Live-tail activity is rendered directly rather than through the completed-turn process group.
- Git's unified-diff default is three context lines. VS Code's `diffEditor.hideUnchangedRegions.contextLineCount` also defaults to three, and Codex's apply-patch guidance asks for three lines above and below a change. The installed Pi edit tool supplies four, so a three-line browser presentation follows the common convention without needing new source data.
- Preserve unrelated working-tree changes, including existing plan edits. Do not run `next build` during development.

## Test Strategy

Add focused browser-component coverage for disclosure behavior rather than testing implementation text:

1. Add focused `MessageView` rendering/interaction coverage using the repository's existing React plus minimal synthetic-DOM pattern. A recognized edit with a structured patch starts open with accurate native disclosure semantics, exposes the patch, and can be collapsed and reopened.
2. A recognized edit with a plain-text success result and a recognized edit failure start open and show their fallback result content.
3. A non-edit tool remains collapsed by default and remains independently toggleable.
4. Similar but unrecognized tool names do not accidentally inherit the edit default.
5. Prove a settled turn containing an edit defaults its **Process details** group open while a turn without edits remains collapsed; explicit collapse still works.
6. Expand `lib/patch.test.mjs` for multiple hunks/files, overlapping and separated three-line context windows, true omission counts, one-sided changes, no-newline markers, and malformed fallback. Add component structure coverage for file headers/stats, gutters, removed-above-added ordering, language selection/plaintext fallback, reliable intra-line emphasis with ambiguous-pair fallback, soft-wrapped continuations, natural height, inert hostile code, and explicit absence of side-by-side, fixed-height, or nested-scroll layouts. Avoid snapshots of incidental syntax-highlighter markup or inline-style serialization.
7. Run `node --test components/MessageView.test.mjs lib/patch.test.mjs lib/message-display.test.mjs`, then `node_modules/.bin/tsc --noEmit`, `npm run lint`, and `git diff --check`. Use browser screenshots/checks in light and dark themes at a mobile-width viewport and a wide desktop viewport to judge hierarchy, rhythm, wrapping, focus, contrast, and settled-turn behavior with replacement, multi-hunk, and long-line fixtures. Do not run `next build`.

## Telemetry / Debuggability

Not applicable. This is reversible browser-local presentation state with no server transition or persistent state. Disclosure attributes, semantic diff row kinds, omission counts, language/fallback state, and visible patch text are directly inspectable in the DOM. Do not add production logs or analytics for ordinary disclosure toggles.

## Validation Contract

| ID | What must be true | How to verify it | If it fails |
|---|---|---|---|
| VC-001 | Recognized edit tool cards start expanded and show the existing structured patch or fallback result without changing tool/result data. | Focused component tests covering patch, plain-text success, and error results; scoped diff review. | Block until every supported edit-result form remains visible and data handling is unchanged. |
| VC-002 | Each edit card can still be collapsed and reopened independently through a focus-visible native button with a state-specific accessible name, accurate `aria-expanded`, and `aria-controls`; non-color `−`/`+` markers identify diff row meaning. | Interaction/DOM tests plus keyboard and focus browser smoke. | Block on missing semantics, hidden focus, color-only meaning, removed user control, or shared disclosure state. |
| VC-003 | Non-edit tool calls retain their current collapsed default, and edit recognition does not broaden unintentionally. | Positive and negative tool-name cases in focused tests. | Narrow the detection/default seam before shipping. |
| VC-004 | A completed turn containing a recognized edit starts with **Process details** open, while a completed turn without edits retains its collapsed default; either group remains manually toggleable. | Focused completed-turn integration test plus browser smoke. | Block until edits remain visible after settlement without globally expanding unrelated turns. |
| VC-005 | Structured patches show changed hunks—not whole files—in a full-width top-to-bottom layout with removed content above added content, exactly three context lines on each side, useful file/location context, and no split view at any width. Long lines soft-wrap with aligned continuation text and no horizontal scrolling. Expanded cards grow naturally in the main transcript with no fixed-height cap or nested scrolling. Recognized files retain restrained syntax color, context is dimmed, and reliable removed/added pairs emphasize exact changed text without inventing matches for ambiguous rows. | Structural renderer tests plus browser screenshots/checks covering one-file, multi-file, addition, deletion, equal/unequal replacement runs, recognized/unknown languages, long-line, large, context-heavy, and multi-hunk examples in both themes and representative widths. | Block on lost or misleading change information, excessive unchanged content, unreadable/competing contrast, misaligned wrapping, nested scrolling, fixed-height clipping, or any side-by-side/narrow-column presentation. |
| VC-006 | Patch text remains inert and exact: syntax/intra-line rendering never interprets code as HTML, changes code text, or stalls on oversized/pathological input; unsupported structure or language falls back to truthful plaintext rows. | Hostile-code escaping tests, text-equivalence assertions, bounded-fallback tests, and scoped review proving no raw-HTML path or new dependency. | Block on injection, text loss/reordering, misleading highlights, or unbounded expensive decoration. |
| VC-007 | Relevant tests, typecheck, lint, and whitespace validation pass with no unrelated source changes and no Next build. | Record focused test commands, `node_modules/.bin/tsc --noEmit`, `npm run lint`, `git diff --check`, browser evidence, and scoped status/diff review. | Fix failures or report a genuine environment blocker; do not weaken the behavior contract. |

## Assumptions, Risks, and Blockers

- **Blockers:** None currently known.
- **Assumption:** “edits” means tool calls recognized by the existing `isEditToolName(...)` policy, not editable user messages, file-viewer diffs, or extension widgets.
- **Accepted consequence:** opening an edit-containing **Process details** group also exposes the thinking and other tool activity already grouped with that edit; the plan will not reorder or extract edit blocks.
- **Risk:** initializing every process group as expanded would expose unrelated turns and is broader than requested; the outer default must be edit-aware.
- **Risk:** remounts can reset local disclosure state. The change should preserve current mounted-component semantics and avoid introducing persistence unless separately requested.
- **Risk:** copying a full editor or PR-review surface would pull staging, commenting, navigation, or repository authority into a transcript-only feature. The plan should borrow visual hierarchy only.
- **Resolved risk:** side-by-side columns and horizontal diff scrolling are excluded at every width, so code retains the full available chat-column width and long lines remain visible through aligned soft wrapping.
- **Resolved risk:** exactly three context lines follow the established Git, VS Code, and Codex convention while keeping the card change-focused.
- **Risk:** syntax colors, row tinting, and intra-line emphasis can compete. Theme-aware browser validation must keep syntax subordinate to the diff hierarchy and preserve readable contrast.
- **Risk:** naively pairing unequal or reordered removed/added rows can misstate what changed. Apply intra-line emphasis only when the pairing is reliable and fall back to the truthful whole-row treatment otherwise.
- **Risk:** custom syntax rendering can accidentally lose escaping or become expensive on large patches. Preserve React text-node rendering and use bounded decoration with plaintext fallback.
- **Accepted consequence:** a very large edit can create a tall transcript item. The user prefers natural main-page flow over nested scrolling and can collapse the edit card when needed.

## Implementation Handoff

After this exact plan is finalized and approved, start implementation with:

```text
/start-implementation .agents/plans/2026-08-21-expand-edit-results-by-default.md
```

Approval alone does not start implementation or authorize a commit.
