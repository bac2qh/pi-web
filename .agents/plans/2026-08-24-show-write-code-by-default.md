# Show Write Code by Default

Status: approved

## Objective

Make the built-in `write` tool's code visible by default in the Pi Web transcript, including after a turn settles under **Process details**, while preserving independent collapse/reopen behavior and leaving unrelated tools collapsed.

Success means:

- an exact `write` call defaults collapsed while pending, then automatically opens once when its matching result arrives, whether it succeeds or fails, unless the user has already made a mounted disclosure choice;
- a settled **Process details** group starts open when one of its exact `write` calls has a matching completed result;
- the user can read what the tool wrote without manually expanding JSON arguments;
- write success and failure information remains visible and understandable;
- existing edit review cards keep their current behavior; and
- no unrelated or merely similar tool name inherits the new default.

For `write`, show the complete content supplied to the tool rather than a before/after diff. Describe successful output as written content and failed output as attempted content, never as a comparison.

## Design / Implementation Strategy

### Scope estimate

- **Surfaces:** the shared tool-name/display policy in `lib/message-display.ts`, tool-card rendering in `components/MessageView.tsx`, settled-turn classification in `components/ChatWindow.tsx`, transcript CSS, and focused tests.
- **Testability:** high for classification, default state, content fidelity, collapse behavior, and non-regression. A dedicated code presentation would also need a narrow browser check for wrapping and readability.
- **Implementation difficulty:** low to medium. The selected result is Pi-Web-only and reuses tool-call data already present in every session; no Pi fork or dependency update is needed.

### Current seam and required separation

Keep edit-result recognition separate from the broader “open code mutation details by default” policy. `ToolCallBlock` currently uses `isEditToolName(...)` both to initialize expansion and to suppress ordinary input rendering because an edit normally has authoritative `details.patch`/`details.diff`. Adding `write` to that edit predicate would therefore hide the only stored code while the installed write result contains only a success message.

Introduce exact write-name recognition, but do not copy the edit card's unconditional initial-open state. The current edit card initializes open from its tool name before a result exists; it merely appears result-driven because edit input is suppressed and the patch does not exist until completion. For `write`, initialize open only when a matching completed result is already present. For a mounted live card, detect the first absent-result-to-result transition and open once for either success or failure, unless the user already toggled that disclosure. Later result identity changes must not reopen it. Do not render either raw write JSON or the dedicated content body from partial/pending arguments.

For settled grouping, derive a set of completed tool-call IDs from the existing result map and combine the current edit policy with an exact grouped `write` block whose ID belongs to that set. Keep matching scoped to the precise blocks inside that group so an outside write or orphan result cannot open it. Preserve the existing edit-only patch treatment and write-content treatment as distinct rendering paths. Manual state remains mounted browser state; do not add persistence, a global setting, or a new generic disclosure framework.

### Selected written-content presentation

After completion, render the exact string at `write.input.content` as a dedicated, inert code surface. Use the string `write.input.path` in the header and for the existing file-language mapping. Label successful output **Written content**; label a failed call **Attempted content** and keep its result text visible alongside it. Suppress the generic raw-JSON input for a valid write. If completed historical data lacks string `path` or `content`, do not coerce or guess: show the ordinary safe JSON/result fallback instead of the dedicated code view.

When open, present the complete stored content at natural transcript height with soft wrapping and no nested vertical scrollbar. Collapsing must unmount the expensive code child. Show neutral decorative line numbers for review readability, with no added/deleted markers or coloring because `write` may overwrite an existing file. Keep line numbers out of accessible code text and text selection. Empty content must remain distinguishable as an intentional zero-byte body rather than disappearing.

Reuse the current disclosure, path preview, transcript typography, `getFileLanguage(...)`, theme styles, and `react-syntax-highlighter` dependency rather than add a package. Apply syntax coloring only within explicit line/character budgets. Above the syntax budget or for an unsupported language, render every line through a simpler line-numbered plaintext path; the fallback may remove decoration other than line numbers but must never truncate, rewrite, interpret as HTML, or reread content from disk. A true historical diff, Pi-fork change, current-filesystem comparison, and dependency repin are explicitly excluded.

## Reference Files

- [Repository architecture and pinned Pi-fork constraints](../../AGENTS.md)
- [Tool-card and structured patch rendering](../../components/MessageView.tsx)
- [Settled Process details grouping](../../components/ChatWindow.tsx)
- [Shared edit-name/display policy](../../lib/message-display.ts)
- [Existing file-language mapping](../../lib/file-types.ts)
- [Tool-card component coverage](../../components/MessageView.test.mjs)
- [Display-policy coverage](../../lib/message-display.test.mjs)
- [Transcript disclosure and edit-card styles](../../app/globals.css)
- [Local fork dependency declaration](../../package.json)
- [Local fork dependency integrity lock](../../package-lock.json)
- [Pi `write` implementation at inspected sibling revision](https://github.com/bac2qh/pi/blob/f77fb2c823c122b59f1b3ddf7014c30f149f17e9/packages/coding-agent/src/core/tools/write.ts#L137-L267)
- [Codex `apply_patch` protocol conversion at inspected sibling revision](https://github.com/openai/codex/blob/74e9d7efc416b1cb9f3ad10c70a91afbcb6d6a29/codex-rs/core/src/apply_patch.rs#L77-L102)
- [Codex patch transcript renderer at inspected sibling revision](https://github.com/openai/codex/blob/74e9d7efc416b1cb9f3ad10c70a91afbcb6d6a29/codex-rs/tui/src/diff_render.rs#L392-L522)

## Evidence and Constraints

- The observable transcript identity is the exact, case-sensitive tool name `write`; near matches must not inherit the behavior. Session blocks carry no built-in-versus-extension provenance, so an extension that deliberately replaces the exact `write` name necessarily shares this presentation contract unless provenance is added in separate scope.
- The session's write call contains `{ path, content }`, so Pi Web already has the complete requested body and, after success, the complete post-write text.
- The installed write result is only `Successfully wrote … bytes to …` with `details: undefined`; unlike `edit`, it has no authoritative `patch` or `diff`.
- The installed Pi TUI and the inspected `../pi` revision derive write presentation from the call's `path` and `content`, syntax-highlight by path, show ten lines while the shared tool-output state is collapsed, and show the whole body when expanded. Pi uses a neutral code presentation without line numbers or diff markers. Its renderer suppresses the byte-count result on success and appends only failures, although the underlying result still contains the byte count.
- At inspected revision `74e9d7e`, Codex has no equivalent standalone first-party `write` tool in the normal core tool plan. Its semantic file-mutation surface is `apply_patch`: new files carry complete content, updates carry a unified diff, and deletions carry removed content. The TUI installs a persistent patch history cell at patch start; an added file is shown in full with a path/count header, syntax decoration, line numbers, and `+` markers. Successful completion leaves that cell in place, while failure adds a failure cell. Shell commands can also write files but remain ordinary command presentation rather than a semantic whole-file write view.
- The comparison supports using the write-call input as the source of truth. Pi supplies the closest semantic precedent; Codex's always-visible Add view supports complete line-numbered review, but its `Added`/`+` semantics must not be copied for an overwrite-capable `write` tool.
- Successful edit results already prefer `details.patch`, then `details.diff`; that machinery should not be changed merely to open writes.
- Opening a settled **Process details** group also exposes other process activity in that turn, matching the already accepted edit behavior.
- Preserve unrelated working-tree changes. Do not run `next build`.

## Test Strategy

Add focused cases proving that:

1. exact `write` recognition is separate from edit recognition and rejects similar names;
2. a pending write card defaults collapsed without mounting raw or dedicated content; the first successful or failed completion opens an untouched card once, while a pre-completion user toggle and later result updates remain authoritative;
3. only a matching completed write inside the exact settled group opens **Process details**, after which the group and card remain independently collapsible and reopenable;
4. successful **Written content** and failed **Attempted content** render every source character inertly with the path and neutral decorative line numbers, including hostile strings, empty content, final newlines, tabs, and long lines, while result status remains understandable;
5. malformed completed write input uses the safe ordinary fallback; edit cards retain structured patch rendering; and ordinary or near-name tools retain their current collapsed default; and
6. oversized or unsupported content keeps all text and line numbers through the plaintext path without syntax work, content corruption, or nested transcript scrolling.

Run the focused display/component tests, TypeScript, lint, and `git diff --check`. Because this adds a new code surface, perform a browser smoke in light and dark themes at representative wide and narrow chat widths, covering pending, successful, failed, long-line, and collapse/reopen states. Do not run `next build`.

## Telemetry / Debuggability

Not applicable. This is browser-local presentation of data already stored in the transcript. The disclosure attributes, exact tool classification, content surface, and fallback state are directly inspectable in the DOM; do not add logs or analytics.

## Validation Contract

| ID | What must be true | How to verify it | If it fails |
|---|---|---|---|
| VC-001 | Exact `write` cards default collapsed while pending, open once on their first success or failure result unless manually touched, and do not reopen on later updates; only matching completed writes make their exact settled **Process details** group start open. | Focused classification, result-transition, manual-override, and exact-group interaction tests. | Block until completed write code becomes visible without exposing pending content or opening unrelated activity. |
| VC-002 | The transcript truthfully exposes complete call-time content from the session, labels success versus failure accurately, and never reads mutable current-file state or invents a diff. | Content-fidelity, status-label, empty-body, and scoped data-flow tests. | Block on missing/corrupted content, a misleading label, or a historically unstable comparison. |
| VC-003 | Write results remain understandable, malformed write data falls back safely, existing edit patch cards do not regress, and ordinary/near-name tools retain their current default. | Component cases for write success/error/malformed input, edit patch/plain/error, and ordinary/near-name tools. | Restore the separate recognition and rendering paths before shipping. |
| VC-004 | Complete write content remains inert and readable at natural height; line numbers are decorative; syntax work is bounded; and oversized/unsupported content retains all text through line-numbered plaintext. | Hostile/exact-text and over-budget tests plus light/dark, wide/narrow browser smoke. | Block on injection, text changes, lost line numbers/content, nested scrolling, or unbounded syntax work. |
| VC-005 | Focused tests, typecheck, lint, whitespace validation, and the required browser smoke pass with no unrelated source changes and no Next build. | Record commands, browser cases, and scoped status/diff review. | Fix failures or report a genuine blocker; do not weaken the contract. |

## Assumptions, Risks, and Blockers

- **Blockers:** None currently known.
- **User decisions:** show the complete content supplied to `write`, not a diff; present it as neutral syntax-highlighted code with decorative line numbers and no added/deleted markers; do not auto-expand or mount the dedicated content surface while the write is pending; auto-open once after either success or failure, labeling failures **Attempted content** and retaining the error.
- **Assumption:** the exact `write` name follows Pi's built-in `{ path, content }` contract. Near-name extension tools are excluded; an exact-name replacement cannot be distinguished from the transcript data available today.
- **Risk:** treating write as an edit would suppress its input under the current renderer and show only the byte-count result.
- **Risk:** complete writes can be tall. The selected presentation must keep collapse available and bound expensive decoration without silently omitting or changing stored content.
- **Excluded scope:** do not modify the Pi fork, capture pre-write bytes, synthesize a diff, or update the pinned dependency.
- **Accepted consequence:** default-opening a write-containing settled group also reveals the turn's other grouped process content, consistent with edit-containing groups.

## Implementation Handoff

After this exact plan is finalized and approved, start implementation with:

```text
/start-implementation .agents/plans/2026-08-24-show-write-code-by-default.md
```

Approval alone does not start implementation or authorize a commit.
