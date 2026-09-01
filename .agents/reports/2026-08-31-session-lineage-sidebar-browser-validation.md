# Session Lineage Sidebar Browser Validation

Date: 2026-09-01

## Environment

- Pi Web development server from the task worktree on isolated port `30155`
- Isolated `PI_CODING_AGENT_DIR` fixture under the main-root ignored runtime directory
- Headless Google Chrome through globally installed Playwright
- Desktop viewport: `1440 × 1000`
- Mobile viewports: `600 × 800` and short `600 × 480`
- No `next build` was run

The fixture used synthetic titles/IDs and local repository/runtime paths only. It contained one multi-level native family across the task worktree, retained main checkout, and a synthetic second project; an explicit hidden subtree; and unrelated project roots for scrolling. No real user session content was used.

## Result

Passed 42 browser assertions with zero failed HTTP responses and zero browser console/page errors.

Validated:

- Pinned, Recent, Lineage, Project, Explorer order.
- Lineage expanded by default and Project collapsed by default.
- Exact visible-family membership from the oldest available ancestor, exclusion of unrelated roots, hidden-subtree omission, newest-descendant sibling ordering, and depth-first traversal.
- Compact visible cross-worktree/cross-project prefixes plus full Lineage accessible context.
- Continuous ancestor lines, joined child elbows, and deep rows.
- Keyboard selection from Recent expands/reveals only the selected Lineage path and keeps focus in Recent.
- Pointer and keyboard reopening of the already selected session retriggers the same Lineage-only reveal without moving keyboard focus.
- Project branch collapse and `scrollTop` remain unchanged across selection.
- Independent Lineage/Project section open state and retained scroll positions.
- A selection made while Lineage is closed preserves that explicit closure and is revealed when reopened.
- Hidden selected-session explanation; Show hidden restoration; explicit/inherited hidden labels.
- Mobile `600px` operation with both trees open, usable height shares, zero horizontal sidebar overflow, deep connectors, and visible shared row actions.
- Short `600 × 480` operation with actual Lineage/Project scroll-owner heights above `63px`, independent overflow, and successful Project-row activation after the fixed Project controls.

Selected retained measurements:

- Desktop Lineage/Project retained scroll positions: `120` / `160` px.
- Deep connector row: one continuing ancestor line, `27px` current segment, joined `9px` elbow.
- Mobile `600 × 800` Lineage/Project section heights: `145.484375px` / `210.0625px`.
- Mobile sidebar overflow: `0px`; deep selection-control width: `175px`; rendered elbows: `29`.
- Short-mobile actual Lineage/Project scroll-owner heights: `64px` / `63.15625px`; both independently scrollable.

## Evidence

Durable summary data is represented in this report. Ignored raw evidence remains at:

`/Users/xin/Documents/repos/pi-web/.agents/runtime/2026-08-31-session-lineage-sidebar/`

Key files:

- `browser-validation.json`
- `browser-validation.mjs`
- `desktop-lineage.png`
- `show-hidden-lineage.png`
- `mobile-lineage.png`
- `mobile-short-lineage.png`
- `dev-server.log`

The development server was terminated and the task worktree's generated `.next/` directory was removed after validation.
