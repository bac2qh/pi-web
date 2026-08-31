# Session DAG Preview Quick Add Browser Validation

**Date:** 2026-08-31

**Result:** Passed

**Browser:** Headless Google Chrome through Playwright

**Application:** Isolated Pi Web development server on port 30153 with synthetic session and graph fixtures under the main project root's ignored `.agents/runtime/2026-08-30-dag-preview-node-edge-addition/` directory

## Scope

The browser pass started with fourteen rendered active nodes and nine active edges, including a self-edge, reverse pair, unavailable endpoint, duplicate labels, and one selected chat session. A fifteenth valid session existed outside the active graph for newly connected-node coverage. The run used an isolated `PI_CODING_AGENT_DIR`; normal user session and DAG state were not read or mutated.

The ignored-runtime driver resets its isolated graph fixture before each run and verifies that the server exposes the synthetic session IDs before sending a mutation. From this task checkout, start the isolated server and run the driver with:

```bash
# Terminal 1, from this task checkout
RUNTIME=/Users/xin/Documents/repos/pi-web/.agents/runtime/2026-08-30-dag-preview-node-edge-addition
PI_CODING_AGENT_DIR="$RUNTIME/agent" PORT=30153 PI_WEB_NO_OPEN=1 npm run dev

# Terminal 2, after Terminal 1 reports port 30153 ready
RUNTIME=/Users/xin/Documents/repos/pi-web/.agents/runtime/2026-08-30-dag-preview-node-edge-addition
node "$RUNTIME/browser-validation.mjs"
```

Stop the Terminal 1 development server with Ctrl-C after the driver exits.

## Result summary

The final machine-readable result records revision 13, thirteen ordinary active edges, fifteen rendered nodes, fifteen node-add controls, thirteen edge controls, one intentional rejected mutation response, and zero unexpected browser errors.

### Larger edge actions

- Every active edge retained one midpoint-associated dot in TD and LR, with validated midpoint distance below 1.5 CSS pixels.
- The visible dot and hit target exposed the approved 5- and 14-unit radii.
- Expanded Swap and Insert backgrounds measured 48×22 SVG units with a 9-unit label.
- TD placed the two actions horizontally around the midpoint; LR placed them vertically. Executable rectangle and hit-testing assertions found no overlap with each other, the enlarged hit target, Mermaid nodes, or node controls in either direction.
- Pointer activation, self-edge Swap disabling, Insert availability, and reversible non-self Swap remained intact.

### Node quick add

- Every rendered active node exposed one persistent trusted top-left **+**. Eligible completion controls remained at top-right; the selected-session marker, add control, and completion control coexisted without control overlap.
- One node form displaced an open edge interaction and one node control displaced another, proving a single authored interaction owner.
- The exact-ID input took focus when opened. Pressing Enter in the input sent no request and selected no direction.
- Entering the anchor's own ID produced bounded correctable feedback, sent no request, retained the draft, and focused the chosen Incoming action.
- **Incoming** connected the previously absent valid session to the anchor through one ordinary `add_edge`, increasing the rendered node count by one and restoring focus to the unchanged anchor **+** after authoritative rerender.
- **Outgoing** connected an anchor to a different already-active node through one ordinary `add_edge` in the opposite endpoint order.

### Rejection, concurrency, and retained behavior

- An exact duplicate directed pair returned the one intentional `409`, left authority at the same revision, retained the exact draft and chosen Incoming direction through the authoritative rerender, and accepted a corrected retry.
- A held successful request made the input read-only, marked the form busy, exposed guarded direction/Cancel controls, and suppressed repeated submission, Cancel, and outside dismissal.
- While that response remained held, a newer authority was adopted. Releasing the older success closed the form and restored immediate anchor focus without leaving work that could steal focus during a later rerender.
- Completion archived the expected edge; Undo, Redo, and a final Undo restored and rearchived it exactly. Preview mode survived panel hide/reopen, and an unchanged focus-triggered refresh retained an applicable open draft.

### Responsive and visual review

The repeatable driver generated and the parent inspected these ignored-runtime screenshots:

- `desktop-dark-node-add.png` — normal desktop split layout
- `narrow-dark-node-add.png` — 780 px expanded right panel
- `mobile-dark-node-add.png` — 600 px mobile full-width panel
- `edge-actions-dark.png` — enlarged LR edge dot and revealed Swap/Insert controls
- `edge-actions-dark-crop.png` — graph-only collision review

The node form remained visible and inside the right panel at all three widths, with no document-level horizontal overflow. Light and dark themes, TD and LR directions, selected-node styling, completion controls, node controls, edge dots, reverse curves, and the self-loop remained visible.

## Persistence and privacy

The final stored graph remained schema version 1 with one form. Active edges retained only `id`, `formId`, `fromSessionId`, `toSessionId`, and `order`; no standalone node, direction draft, trusted-control class, label, or browser-only state was persisted. Trusted control attributes contained no exact session IDs. Exact IDs remained only in the intended editable input/value path and existing non-structural node tooltip behavior.

## User-authorized validation adjustment and residual limits

- On 2026-08-31 the user explicitly declined a keyboard-shortcut browser pass and stated that these controls will be used with the mouse. The implementation's existing Enter/Space button semantics remain in place and focused source/control tests still cover their wiring, but this rerun used pointer activation for authored controls. Input Enter was exercised only to prove that it does not guess a direction.
- Accessibility roles, names, focus, and busy/disabled semantics were inspected, but no platform screen reader was run.
- The newer-authority ordering case used one visible browser with a held response and direct isolated-authority mutations rather than two visible browser windows.
- No production build was run, as required by the approved plan and repository development instructions.
