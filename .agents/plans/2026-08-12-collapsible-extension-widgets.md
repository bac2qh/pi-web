# Collapsible Extension Widgets

Status: approved

## Objective

Make every Pi Web card rendered through extension `setWidget()` individually collapsible so users can reclaim chat-editor space, especially on mobile, without changing extension-owned content, server-side factory rendering, projected session state, or custom extension panels such as `/subagents-fleet`.

Success means:

- every array- and factory-origin widget above or below the editor has an obvious touch, pointer, and keyboard-accessible expand/collapse control;
- collapsing hides only that widget's rendered body while retaining its header, identity, placement, live updates, and authoritative lines;
- multiple widgets can be controlled independently in empty and established chats;
- untouched widgets start collapsed at the mobile breakpoint (`≤640px`) and expanded above it, while an explicit user toggle overrides later viewport changes for that widget;
- each collapsed header remains available so the user can immediately expand the widget again; and
- existing line capping, slot scrolling, editor layout, extension projection, and `/subagents-fleet` behavior remain unchanged.

## Design / Implementation Strategy

### Scope estimate

- **Surfaces:** browser-only widget presentation in `components/ExtensionWidgets.tsx`; mounted-chat state and the shared above/below composition seam in `components/ChatWindow.tsx`; focused component tests; and the maintained extension-widget note in `AGENTS.md`.
- **Testability:** high for independent toggles, disclosure semantics, responsive defaults, state reconciliation, and current-content rendering. Touch target, focus, and layout quality require a small browser smoke pass.
- **Implementation difficulty:** low to medium. No server, extension, projected protocol, reducer, WebSocket, dependency, or browser-storage change is needed; the main work is implementing and testing per-key explicit overrides above both placement slots.

### Proposed browser-only behavior

Treat “widget” narrowly as each card passed to `ExtensionWidgets`: both `string[]` and server-rendered factory widgets, in either `aboveEditor` or `belowEditor`. Extension status chips, dialogs, the chat editor, and `ctx.ui.custom()` panels are out of scope.

Turn each existing widget header into a full-width native button with a practical mobile touch target, a conventional disclosure indicator, visible focus, and a state-specific accessible name such as “Expand widget `<key>`” or “Collapse widget `<key>`.” Set `aria-expanded` and `aria-controls`, and associate them with a collision-safe generated body ID rather than interpolating an arbitrary extension key into the DOM ID. Keep the controlled body mounted but apply the HTML `hidden` attribute while collapsed so it leaves both layout and the accessibility tree while remaining the button's valid control target. Do not nest another interactive control in the header.

Collapse/expand must be browser presentation only:

- never call `setWidget`, mutate projected lines, or notify the extension;
- keep receiving replacement and `requestRender()` output updates while collapsed;
- show the latest lines when reopened;
- retain the existing ten-logical-line display cap whenever the body is shown;
- keep independent state for widgets with different keys;
- treat a widget with no explicit choice as collapsed at `≤640px` and expanded above `640px`;
- let untouched widgets follow that default when the viewport crosses the breakpoint, but preserve a widget's explicit expand/collapse override across later viewport changes;
- retain that override through line updates, reordering, and movement between above/below slots while the same key remains present in the selected chat; and
- discard the override when that key disappears, a different chat is selected, or the page reloads, so a later appearance starts from the responsive default rather than browser-persisted state.

Represent “no explicit choice yet” separately from explicit expanded and collapsed choices. Own the per-key override map in `ChatWindow`, before partitioning into above/below slots, and pass the effective state and toggle callback into both `ExtensionWidgets` renderers. For example, a widget first seen on mobile starts collapsed; if the user expands it, it remains expanded through desktop/mobile transitions and live updates while it remains present. The collapsed header and disclosure button always remain visible so it can be restored immediately.

Use mounted chat-view React state only; do not use browser storage. Reconcile the override map against the complete current widget-key set so removal resets a key while reordering and placement changes do not. Existing `AppShell` chat selection remounts `ChatWindow` through `key={sessionKey}`, providing the selected-chat reset boundary without adding session identity to widget state; a page reload naturally remounts all state. Materializing the currently open new chat as a saved session is not a chat switch and must not reset its choices.

Prefer native browser and React behavior over protocol changes, dependencies, animation frameworks, or a generic panel system. Do not add terminal-input emulation or change `/subagents-fleet`.

## Reference Files

- [Repository architecture and extension-widget boundary](../../AGENTS.md)
- [Current widget cards, line cap, partitioning, and editor composition](../../components/ExtensionWidgets.tsx)
- [Focused widget presentation and layout tests](../../components/ExtensionWidgets.test.mjs)
- [Empty and established chat integration](../../components/ChatWindow.tsx)
- [Mobile breakpoint hook](../../hooks/useIsMobile.ts)
- [Session selection and mounted ChatWindow boundary](../../components/AppShell.tsx)
- [Browser-local preference conventions](../memory/display-preferences.md)
- [Factory-widget implementation plan](2026-08-11-extension-factory-widgets.md)
- [Factory-widget implementation evidence](../checkpoints/2026-08-11-extension-factory-widgets-checkpoints.md)

## User Decisions, Constraints, and Current Evidence

- **User decision — responsive default:** untouched widgets are collapsed at `≤640px` and expanded above `640px`; an explicit toggle overrides later viewport changes while that widget remains present. This prioritizes mobile editor space while always retaining a way to reopen the widget.
- **User decision — state lifetime:** an explicit choice survives line updates, reordering, and placement changes while its key remains in the selected chat. It resets when the key disappears, a different chat is selected, or the page reloads; there is no browser persistence.
- The browser already receives only `{ key, lines, placement }`; collapse is not extension authority and does not require a wire/schema change.
- `ExtensionWidgets` currently renders a noninteractive key header and an always-visible `<pre>` body. It is shared by above- and below-editor slots and by array/factory origins.
- ChatWindow already gives each placement a bounded, independently scrollable slot and uses the same `above → editor → below` composition in empty and established chats.
- Current browser policy caps expanded presentation at ten logical lines plus a marker without truncating server/projected state.
- Persistent extension-widget terminal input remains unsupported; this plan adds only web-native disclosure controls and does not make terminal hints interactive.
- Preserve unrelated `.agents/plans/` changes and all other user work. Do not run `next build` during development.

## Test Strategy

Extend `components/ExtensionWidgets.test.mjs` with focused interaction coverage using the repository's existing `createRoot` plus minimal synthetic-DOM pattern; do not add JSDOM or another test dependency:

1. Render multiple above/below widgets and prove each native disclosure button toggles only its own controlled body, with accurate `aria-expanded`, `aria-controls`, generated ID association, `hidden` state, accessible name, and focusability. Confirm Enter/Space through native-button semantics in the test and an actual browser keyboard smoke pass rather than reimplementing browser keyboard behavior in the synthetic DOM.
2. Replace lines while collapsed, then reopen and prove the latest capped body appears without changing the authoritative input.
3. Prove an explicit choice survives line updates, reordering, and above/below placement movement while its key remains present, but resets after key removal or chat-view remount. Verify by inspection that no storage path is introduced, making reload reset naturally.
4. Prove untouched widgets follow the `≤640px` collapsed / wider expanded default across breakpoint changes, while either explicit choice remains stable across later viewport changes.
5. Keep existing 10/11-line, partition order, empty/established composition, bounded slot, and editor-menu tests green.
6. Manually verify touch targets, focus indication, no editor/composer overlap, and independent widgets at narrow mobile and desktop widths.

Expected validation is `node --test components/ExtensionWidgets.test.mjs`, any directly affected existing component test, `node_modules/.bin/tsc --noEmit`, `npm run lint`, and `git diff --check`. `next build` is excluded by repository policy.

## Telemetry / Debuggability

No server telemetry or logging is warranted because collapse is reversible, mounted-chat browser presentation state. Accessibility state (`aria-expanded` and the controlled body id) is the inspectable signal. No browser storage is added.

## Validation Contract

| ID | What must be true | How to verify it | If it fails |
|---|---|---|---|
| VC-001 | Every extension widget card, regardless of origin or placement, can be independently collapsed and expanded with touch, pointer, Enter, and Space. | Focused interaction tests plus desktop/mobile browser smoke with multiple widgets. | Block; do not ship a mouse-only or shared-all-widgets toggle. |
| VC-002 | Each native disclosure button has an accurate state-specific accessible name, `aria-expanded`, visible focus, and `aria-controls` association with a collision-safe generated body ID; the controlled body is `hidden` when collapsed. | Synthetic-DOM assertions plus actual browser keyboard/focus smoke. | Block on missing semantics, inaccessible focus, unsafe/colliding IDs, or state mismatch. |
| VC-003 | Collapsing is presentation-only: live line replacement continues, authoritative/projected data is unchanged, and reopening shows the latest body under the existing line cap. | Rerender/update tests with immutable input assertions and a scoped diff proving no projection/protocol changes. | Block on stale content, extension-side mutation, or unplanned protocol work. |
| VC-004 | Untouched widgets are collapsed at `≤640px` and expanded above it; breakpoint changes update untouched widgets but never overwrite an explicit per-widget choice. A choice survives updates, reordering, and placement movement while its key remains present, then resets on removal or chat-view remount without transferring to another widget. Materializing the current new chat does not reset it. | Responsive-default, explicit-override, complete-key-set reconciliation, and remount tests, including mobile → desktop → mobile transitions; inspect the existing new-chat materialization seam and confirm no browser storage was added. | Block until behavior is deterministic and matches the plan. |
| VC-005 | Existing empty/established placement, bounded slot scrolling, editor menus, custom panels, and `/subagents-fleet` remain unchanged. | Existing component regressions plus responsive manual smoke. | Fix regressions; do not broaden this plan into custom-panel or terminal-input redesign. |
| VC-006 | Relevant tests, typecheck, lint, and whitespace validation pass with no unrelated changes and no Next build. | Recorded commands and scoped status/diff review. | Fix failures or explicitly report a genuine environment blocker. |

## Assumptions, Risks, and Blockers

- **Blockers:** None known.
- **Assumption:** widget keys are the extension-provided identity within one selected chat view; no global uniqueness across chats is implied.
- **Resolved design risk:** choices are mounted-chat state only, so common keys cannot leak across selected chats or reloads.
- **Resolved design risk:** viewport-driven defaults must not overwrite user intent; implementation must distinguish an untouched widget from explicit expanded and collapsed choices.
- **Risk:** merely clipping overflow instead of applying the body's actual `hidden` state can leave inaccessible reading behavior; disclosure semantics must control actual presentation.
- **Risk:** dynamic widget updates may be frequent, so state reconciliation must not reset or persist on every line update.

## Implementation Handoff

After this exact plan is approved, start implementation with:

```text
/start-implementation .agents/plans/2026-08-12-collapsible-extension-widgets.md
```

Approval alone does not start implementation or authorize a commit.
