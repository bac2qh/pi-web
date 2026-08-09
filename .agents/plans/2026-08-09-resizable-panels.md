# Resizable Application Panels

Status: approved
Date: 2026-08-09
Approved by user: 2026-08-09

## Objective

Allow users in the ordinary desktop split layout to resize both horizontal boundaries: sidebar/conversation and conversation/file viewer.

Success means:

- pointer dragging resizes either applicable boundary smoothly without remounting or interrupting the conversation or file viewer;
- both separators are keyboard-operable and expose current bounded values to assistive technology;
- the sidebar, conversation, and file viewer retain usable minimum widths, including after viewport changes or restoration of stored values;
- user-selected sidebar and file-viewer widths persist independently in the current browser and have a discoverable reset to today’s defaults;
- existing collapse controls, file-viewer expansion, automatic full-width viewing below `1000px`, and mobile layouts retain their current behavior.

## Design / Implementation Strategy

1. Extend the existing `AppShell` flex layout; add no panel-layout dependency. A non-ancestor repository-history commit, `9d1721f` (`feat: add draggable sidebar resize with localStorage persistence`, upstream PR #266), already implements the same basic interaction. Adapt its reusable Pointer Events, CSS-variable, accessibility, and pure-constraint approach to current main rather than cherry-picking it: current `AppShell` has since added mounted expanded-viewer state and a separate `<1000px` automatic full-width contract.
2. Add a small pure `lib/panel-layout.ts` model for defaults, storage parsing, and effective bounds. Use these initial bounds, already exercised by the upstream implementation, then protect current layout geometry with a dynamic center reservation:
   - sidebar: default `260px`, absolute range `180–480px`;
   - file viewer: default to the current responsive `42%` width, absolute range `300–1200px`;
   - conversation: reserve at least `320px` while desktop split resizing is active;
   - each panel’s dynamic maximum also accounts for the other visible panel and the conversation reservation.
3. Distinguish a user’s **preferred width** from the **effective width** allowed by the current viewport. Store only intentional drag/keyboard choices under guarded browser-local keys such as `pi-sidebar-width` and `pi-right-panel-width`. A narrower viewport or newly visible panel may temporarily clamp the effective width but must not overwrite the preferred stored value; returning to a feasible desktop layout restores it. With no stored file-viewer width, retain responsive `42%` behavior. Reset removes the corresponding preference and restores `260px` or responsive `42%` semantics.
4. Add one reusable `useResizablePanel` hook and instantiate it twice in `AppShell`. Use Pointer Events and `setPointerCapture()` for mouse, pen, and touch. During a drag, mutate only the panel CSS variable/ref and live ARIA value so the large chat tree does not rerender on every pointer move; perform one React/storage commit on completion. Accept only the primary mouse button, disable width transitions and text selection only while active, and restore cursor/selection/capture state on pointer up, cancellation, lost capture, blur, visibility loss, or unmount.
5. Insert a net-zero-width separator over each existing one-pixel pane border, with a wider transparent hit area and a narrow visible hover/focus/active line. Each is a focusable vertical `role="separator"` with a pane-specific accessible name, `aria-controls`, `aria-valuemin`, `aria-valuemax`, `aria-valuenow`, and pixel-valued text. Arrow keys make small changes, Shift accelerates them, Home/End use the current bounds, and Enter or double-click resets to the default.
6. Render and activate separators only at `1000px` and wider, where the maintained ordinary three-pane layout applies. The sidebar separator additionally requires an open sidebar; the file separator requires an open, non-expanded right panel. Hide or omit both during mobile layout, automatic/manual full-width file viewing, or panel closure. Existing native sidebar/file-panel buttons remain the only collapse controls; dragging does not collapse a pane to zero.
7. Replace fixed desktop widths at every existing owner with CSS-variable fallbacks: the sidebar and its fixed-width children, plus the right panel and its independently constrained direct children. Preserve the current open/close animations outside active dragging, center-pane container queries, `640px` mobile layout, `<1000px` automatic expansion and restore suppression, and full-width expanded overrides. New direct-child handles must not remain visible or pointer-active when expansion hides the surrounding shell.
8. Reconcile effective widths when desktop eligibility, viewport size, panel visibility, or expansion changes. Pairwise dragging changes only the selected side panel and the adjacent flexible conversation; reconciliation must be deterministic, finite, and unable to create document-level horizontal overflow. Collapsing/reopening a panel, expanding/restoring the viewer, closing the final file tab, or crossing a breakpoint preserves the preferred widths without preserving an impossible effective width.

**Rough scope estimate**

- **Surfaces:** `AppShell`, one reusable resize hook, one pure layout helper and tests, panel CSS, and focused responsive-layout regression checks.
- **Testability:** high for parsing/default/bound calculations; moderate for pointer capture, keyboard semantics, persistence, mounted identity, and breakpoint composition, which require browser interaction.
- **Implementation difficulty:** moderate. The resize operation is small and an upstream design exists; most care is in integrating two persistent widths with the current expansion and responsive state without rerendering live chat on every pointer move.

## Reference Files

- [`../../components/AppShell.tsx`](../../components/AppShell.tsx) — owns all three panes, visibility, file tabs, file-viewer expansion, and the shell flex layout.
- [`../../app/globals.css`](../../app/globals.css) — fixes the desktop sidebar at `260px`, the file viewer at `42%`/`42vw` with a `300px` minimum, and supplies the mobile/expanded overrides.
- [`../../lib/file-viewer-layout.ts`](../../lib/file-viewer-layout.ts) — owns maintained manual/automatic expansion transitions and the exact `1000px` narrow boundary.
- [`../../hooks/useIsMobile.ts`](../../hooks/useIsMobile.ts) — owns the maintained `640px` and `1000px` viewport signals.
- [`../../lib/file-viewer-layout.test.mjs`](../../lib/file-viewer-layout.test.mjs) — covers responsive expansion provenance and shell integration invariants.
- [`2026-07-29-expand-markdown-viewer.md`](2026-07-29-expand-markdown-viewer.md) — establishes mounted expanded-viewer and both-level width-override constraints.
- [`2026-08-05-agent-response-file-links.md`](2026-08-05-agent-response-file-links.md) — establishes automatic full-width viewing below `1000px` and narrow restore behavior.
- [`../memory/display-preferences.md`](../memory/display-preferences.md) — records browser-local presentation-preference conventions.
- [`../memory/agent-response-file-links.md`](../memory/agent-response-file-links.md) — records current narrow viewer presentation ownership.

## Constraints, Decisions, and Current Evidence

- **User decision, 2026-08-09:** Persist both resized widths browser-locally across reloads. Do not synchronize them to a session, project, server API, or another browser.
- Current main has no resize handle or resize dependency. Width ownership is split between `AppShell` and CSS: sidebar `260px`; right panel `42%`, with direct children independently held at `42vw`; center pane consumes the remainder.
- Upstream PR #266 and released commit `9d1721f` provide direct evidence that a local two-instance hook is sufficient. That implementation uses guarded `localStorage`, pointer capture, direct CSS-variable mutation, `180–480px` and `300–1200px` side bounds, keyboard separators, double-click reset, active-drag transition suppression, and pure width tests.
- The upstream responsive CSS is not directly reusable: it uses a `960px` overlay boundary and predates this fork’s expanded-viewer and automatic `<1000px` state. Current maintained `640px` and `1000px` behavior remains authoritative.
- The WAI-ARIA window-splitter pattern requires a focusable separator, vertical orientation for side-by-side panes, updated value metadata, a pane-specific accessible name, and directional keyboard operation. A mouse-only draggable border is out of scope as an acceptable result.
- The center pane already owns inline-size container queries, so chat width and top controls should react to its actual post-resize width without another chat-content sizing feature.
- Baseline on 2026-08-09: the 24 focused file-viewer layout, display-preference, and mounted viewer tests pass.
- Preserve unrelated working-tree changes. Do not run `next build`.

### In scope

- Horizontal desktop separators for the existing left and right boundaries.
- Browser-local preferred-width persistence, bounded restoration, and reset.
- Pointer, keyboard, focus, ARIA, responsive, expanded-viewer, and mounted-state behavior.
- Focused pure tests and real-browser validation.

### Out of scope

- Vertical/stacked resizing, dragging a panel to zero, or replacing existing collapse buttons.
- Changing the chat-column Width display preference; that controls content inside the conversation, not the pane itself.
- Resizing controls below `1000px`, changing automatic narrow expansion, or introducing a new overlay layout.
- Per-session/project/server synchronization, cross-tab live synchronization, a settings UI, or telemetry.
- A third-party split-pane dependency or broad `AppShell` redesign.

## Test Strategy

- Add pure tests for finite/malformed stored values, responsive `42%` default calculation, absolute and dynamic bounds, preferred-versus-effective behavior, reset semantics, and combinations of viewport size, sidebar/file visibility, and center reservation. Include values far outside bounds and viewport contractions/expansions so temporary clamps cannot erase preferences.
- Add focused source/component invariants for two named vertical separators, conditional visibility, CSS-variable ownership at both panel levels, expanded-state suppression, and preservation of existing mounted `FileViewer` behavior. Do not add a DOM framework solely for the hook.
- Run focused tests while developing, then the complete existing Node test suites, `node_modules/.bin/tsc --noEmit`, `npm run lint`, and `git diff --check`. Do not run `next build`.
- In a privacy-safe development browser at representative wide desktop plus `1000px`, `999px`, `641px`, and `640px`:
  - drag both handles in both directions, rapidly leave panel content/iframe regions, exceed both bounds, and verify pointer-up/cancel/blur cleanup leaves no stuck cursor, selection suppression, or active style;
  - use arrows, accelerated arrows, Home/End, Enter reset, double-click reset, and inspect focus indication and separator ARIA values/names;
  - reload after independent width choices; inject absent, malformed, and out-of-range storage; reset; narrow and widen the viewport; prove preferred values restore only when feasible and the unset file viewer still follows `42%`;
  - collapse/reopen each side, open/close files, expand/restore the viewer, close the final tab, and cross both responsive boundaries; handles appear only in the approved split state and hidden trees remain mounted but non-interactive;
  - verify conversation/file content reflows without remount or lost state, the conversation never falls below its protected desktop width, top controls follow container queries, and neither theme gains document-level horizontal overflow;
  - exercise at least one coarse/touch pointer at desktop width so the Pointer Events path is not mouse-only.

## Telemetry / Debuggability

Production telemetry and server logging are not applicable for synchronous browser-local layout state. Diagnosability comes from explicit separator data hooks, live ARIA values, two bounded storage keys, pure constraint tests, and privacy-safe browser geometry. Storage failures should fall back silently to page-local resizing. Do not log session identifiers, paths, file contents, transcript text, or raw storage payloads.

## Validation Contract

| ID | What must be true | How to verify it | If it fails |
|---|---|---|---|
| VC-001 | At `1000px` and wider, each visible ordinary split boundary supports smooth primary-pointer resizing. Widths remain finite and within the sidebar/file bounds while preserving at least `320px` for the conversation; fast movement, cancellation, lost capture, blur, and unmount cannot leave dragging side effects active. | Pure constraint tests plus browser drags, over-bound movement, pointer cancellation/blur, computed pane geometry, and body cursor/selection inspection. | Treat incorrect geometry, a lost/stuck drag, per-move chat rerendering, or horizontal overflow as blocking; correct the shared resize path rather than patching one handle. |
| VC-002 | Sidebar and file-viewer choices persist independently in guarded browser-local storage. Missing storage preserves today’s `260px`/responsive `42%` defaults; malformed values fail safely; temporary responsive clamps do not erase preferred values; Enter/double-click reset removes the preference and restores default semantics. | Pure parsing/reconciliation tests and browser reload/reset/viewport-round-trip checks with absent, malformed, valid, and out-of-range stored values. | Fix preference ownership or preferred/effective separation; do not ship persistence that can strand, corrupt, or silently shrink a saved layout. |
| VC-003 | Both handles are usable without a mouse: each is visibly focusable, correctly named, identifies its controlled pane, exposes current/min/max values, and responds consistently to arrows, accelerated arrows, Home/End, and reset. Pointer interaction also works through the shared mouse/pen/touch path. | Markup/source scrutiny, accessibility-tree/ARIA inspection, keyboard browser checks, and one coarse-pointer desktop check. | Accessibility or non-mouse failures block completion; do not downgrade the handle to a decorative or mouse-only border. |
| VC-004 | Existing shell behavior is unchanged outside eligible desktop split mode: panel toggles still collapse/restore, the viewer’s split width survives expansion/restoration and tab lifecycle, `<1000px` automatic full-width and `<=640px` mobile layouts remain authoritative, hidden handles are not focusable/pointer-active, and chat/viewer trees do not remount merely because widths change. | Existing layout/viewer tests plus browser checks at `1000/999/641/640`, DOM identity/state probes, collapse/open/close/expand flows, and visual geometry in both themes. | Treat any responsive, mounted-state, focus leakage, or panel lifecycle regression as blocking. |
| VC-005 | The focused and full Node suites, TypeScript, lint, and diff checks pass with no new dependency, server API, setting surface, content-bearing telemetry, or `next build`. | Final command output, dependency/diff/status review, and targeted source search. | Fix changed-surface failures and remove scope expansion; isolate and report only demonstrably unrelated pre-existing failures. |

## Assumptions, Risks, and Blockers

### Assumptions

- “Resize the three panels” means horizontal resizing of the two boundaries in the ordinary desktop split layout; existing buttons continue to own full collapse.
- Width preferences are global to this browser profile rather than tied to a project or session.
- A `320px` protected center matches the narrowest center geometry already produced by today’s defaults at the `1000px` boundary; browser validation must confirm the current top bar/composer remain usable there.
- The historical upstream implementation is design evidence only; implementation starts from current main and current repository contracts.

### Risks

- Current CSS owns right-panel width twice (`42%` outer and `42vw` children); changing only one leaves clipped or oddly animated content.
- Applying a restored width before dynamic clamping can overflow on a smaller viewport; overwriting storage during temporary clamping can permanently lose the user’s preferred layout.
- Updating React state on every pointer move could rerender a large live conversation and make dragging visibly laggy; live mutation must remain narrowly scoped and reconcile once.
- Expanded mode hides selected direct shell children. A newly inserted sibling handle can leak over the full-width viewer unless conditional rendering and CSS both respect expansion.
- Maximum Menu/File Viewer typography and embedded document renderers can expose clipping or pointer-capture gaps at minimum pane widths; browser checks must use representative extremes.
- Focus can be lost when a panel is closed while its separator is focused; existing toggle controls must remain reachable, and conditional unmount must not leave stale global drag state.

### Blockers

None. The only material product choice—browser-local persistence—is resolved.

## Implementation Handoff

After explicit approval, run:

```text
/start-implementation .agents/plans/2026-08-09-resizable-panels.md
```
