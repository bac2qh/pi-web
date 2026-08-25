# Session DAG edge swap browser validation

**Date:** 2026-08-25

**Result:** Passed

**Browser:** Headless Google Chrome, controlled through the Chrome DevTools Protocol

**Application:** Isolated development server on port 30151 with synthetic session and DAG fixtures under the main project root's ignored `.agents/runtime/2026-08-24-session-dag-edge-swap-labels/` directory

## Scope

The browser pass covered the approved interaction and visual contract for Raw endpoint labels and one-action edge swapping. It used thirteen synthetic sessions, nine logical active edges, a missing durable endpoint, duplicate titles across the main checkout and task worktree, a self-edge, a reverse pair, a chain, and a branch. No user session store or normal Pi Web DAG state was used.

The repeatable driver is the ignored runtime script:

```bash
node .agents/runtime/2026-08-24-session-dag-edge-swap-labels/browser-interactions.mjs
```

## Interaction evidence

### Raw

- A committed edge Swap issued exactly one immediate `replace_edge` request, reversed the authoritative endpoints, and cleared the row-local draft so the reversed server state remained visible.
- A trailing new-edge draft swapped its two local values without issuing a request or changing graph revision. Enter remained the only add action.
- Exact session IDs stayed in editable inputs.
- Resolved endpoints showed the current project/worktree-qualified label beneath the input.
- The missing endpoint showed `Session unavailable`; blank and partial draft values showed `Session unresolved`.
- Two equal-title sessions remained distinguishable because one label included the worktree branch.
- Renaming a fixture session refreshed the Raw and Preview labels without changing graph revision, endpoint identity, or DAG storage.
- The committed self-edge Swap was disabled and emitted no request.
- A reverse-pair duplicate attempt returned the existing authoritative conflict feedback and preserved both displayed edges.

### Preview

- Pointer, Enter, and Space each activated Swap successfully.
- A held request followed by repeated pointer, Enter, Space, and key-repeat dispatch produced one request only. The control exposed pending disabled state while in flight.
- A rejected transport response restored the same mounted control. Authoritative 409 responses replaced the render with enabled controls from the returned state.
- Reverse-pair, unavailable-endpoint, and stale-two-client swaps were rejected without changing the intended edge locally.
- The disabled self-edge control ignored pointer, Enter, and Space and emitted no request.
- A completion followed by Undo created Redo; the next accepted direct edge swap cleared Redo and recomputed eligibility from the authoritative response.
- The selected-session marker and completion controls remained present alongside Swap controls.

The accepted synthetic mutations moved revision 0 to revision 8. Rejected and disabled actions did not advance it. The final graph retained nine logical active edges.

## Rendering and trust-boundary evidence

- Nine logical edges produced nine trusted Swap controls.
- Mermaid 11.15 produced eleven rendered paths because the one self-edge expands into three exact cyclic segments; the validated middle segment positioned that edge's control.
- Every control center was within 1.5 CSS pixels of its validated path midpoint in both TD and LR renders.
- The self-edge produced exactly one disabled control.
- The Mermaid graph SVG and trusted control SVG were siblings in one ShadowRoot; no Swap control appeared inside generated Mermaid content.
- Generated `eN` aliases did not appear in accessible Swap names.
- Preview retained fail-closed preparation, current-session marking, and completion controls without browser console or page errors.

## Responsive and visual review

Reviewed screenshots are retained in the ignored runtime `screenshots/` directory:

- `01-preview-td-light.png` — normal desktop TD presentation
- `01b-preview-td-expanded-light.png` — expanded TD graph with all edge controls, reverse-pair curves, and the self-loop visible
- `02-raw-desktop-light.png` — desktop exact IDs, qualified labels, actions, unavailable endpoint, and unresolved draft
- `03-raw-narrow-light.png` — 780 px Raw layout
- `04-preview-lr-dark.png` — restored normal desktop LR layout in dark theme after the mutation and conflict matrix

Observed outcomes:

- Raw labels wrapped beneath their matching exact-ID fields without covering Swap or Delete actions.
- At 780 px and 600 px, every label and Swap button remained visible, the right panel used the expected full-width presentation, and the document had no horizontal overflow.
- Returning to 1440 px cleared automatic narrow expansion after its width transition, restored the normal right-panel width, and reserved at least 320 px for the conversation pane.
- TD and LR controls stayed on their path midpoints. Opposing edges used separate curved paths and separate controls. The self-loop control stayed on the loop rather than a node.
- Light and dark themes preserved visible control borders, text, focus styling, node completion controls, and the selected-session marker.

## Persistence and privacy review

After the interaction matrix:

- persisted state remained version 1;
- active-edge records retained only the existing `id`, `formId`, `fromSessionId`, `toSessionId`, and `order` fields;
- no session label, generated alias, SVG path, trusted-control class, or renamed display title was persisted; and
- no route, store, schema, native session, sidebar, or worktree behavior was introduced by the feature.

The browser driver and screenshots contain only disposable synthetic fixture data and remain ignored runtime evidence. This report intentionally omits fixture session IDs, edge IDs, paths, and mutation payloads.

## Residual limits

- This was a headless Chrome pass, not a screen-reader session. Accessible names, roles, focusability, Enter/Space behavior, disabled state, and focus CSS were inspected programmatically and through screenshots.
- Mermaid geometry was exercised with the installed 11.15 output, including its three-path self-edge expansion. Other Mermaid versions remain protected by the same fail-closed validator rather than assumed compatible.
