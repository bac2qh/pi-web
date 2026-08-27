# Session DAG Edge Action and Insert Browser Validation

**Date:** 2026-08-27

**Result:** Passed

**Browser:** Headless Google Chrome through Playwright

**Application:** Isolated Pi Web development server on port 30152 with synthetic session and DAG fixtures under the main project root's ignored `.agents/runtime/2026-08-26-dag-edge-insert-control/` directory

## Scope

The final browser pass exercised the approved midpoint edge-action and atomic Insert workflow with thirteen synthetic sessions, nine initial edges, a self-edge, a reverse pair, an unavailable endpoint, duplicate labels, a completion/Undo history, and one distinct insertion target. It used an isolated `PI_CODING_AGENT_DIR`; no normal user DAG state or session store was used.

The repeatable ignored-runtime driver is:

```bash
node .agents/runtime/2026-08-26-dag-edge-insert-control/browser-validation.mjs
```

## Result summary

The machine-readable result records 93 assertions, final revision 8, ten logical edges, ten Preview dots, five completion controls, exactly two intentional rejected mutation responses, and zero unexpected browser errors.

### Edge actions and focus

- Every logical edge rendered one compact midpoint dot in both TD and LR directions.
- Pointer, Enter, and Space expanded one edge at a time; selecting another dot transferred expansion.
- Expanded controls exposed separate Swap and Insert actions with endpoint-specific accessible names.
- Escape, Cancel, and outside activation closed the interaction and restored dot focus where required.
- A self-edge kept Insert enabled while only its no-op Swap action was unavailable.
- Mermaid content remained inert: graph SVG, trusted control SVG, and trusted HTML form overlay were siblings in one ShadowRoot, with no trusted controls inside generated SVG.

### Insert success and rejection

- Insert opened one bounded exact-session-ID form anchored to the validated edge midpoint and autofocused its input.
- Endpoint reuse and duplicate-pair attempts returned authoritative `409` responses, retained the exact editable value and open form, restored input focus, and left the original edge unchanged.
- A valid Insert replaced exactly one edge with two fresh edges under one revision, retained the original form, preserved the first presentation order, allocated one new order, preserved every unrelated edge, and cleared Redo.
- Persisted state remained schema version 1 and active-edge records retained only `id`, `formId`, `fromSessionId`, `toSessionId`, and `order`.

### Pending and stale-authority recovery

- A held rejected Insert kept the input focused and read-only, exposed `aria-busy="true"`, kept native form controls focusable with guarded `aria-disabled` state, and suppressed repeated Enter, pointer submission, outside dismissal, and Cancel until settlement.
- Rejection restored an editable input with the entered value and input focus.
- A held Swap continued to suppress repeated pointer/keyboard activation and outside dismissal.
- A successful response delayed behind adoption of a newer revision that restored the same edge expectation cleared the persistent pending interaction instead of leaving the control stranded.

### Responsive and visual review

Reviewed ignored-runtime screenshots:

- `desktop-dark-insert.png` — normal desktop split layout
- `narrow-dark-insert.png` — 780 px automatically expanded right panel
- `mobile-dark-insert.png` — 600 px mobile full-width panel

At all three widths the form remained visible and inside the right panel, the document had no horizontal overflow, and edge controls stayed within 1.5 CSS pixels of validated path midpoints. Dark-theme borders, text, focus rings, completion controls, selected-session markers, reverse curves, and the self-loop remained visible. Light theme was also exercised before the dark-theme screenshots.

## Persistence and privacy

The final stored graph reached revision 8 with ten active edges. No label, path, Mermaid source, generated alias, trusted-control class, Insert draft, or browser-only state was persisted. Browser failure filtering was narrowed to the two exact intentional `PATCH /api/session-dag` `409` responses; no `400`, unrelated failed response, console exception, or page exception was accepted.

The driver, fixtures, result JSON, logs, and screenshots remain ignored runtime evidence. This report intentionally omits synthetic session IDs, edge IDs, endpoint pairs, and mutation payloads.

## Residual limits

- The pass inspected browser accessibility roles, names, attributes, focus, and keyboard behavior but did not run a platform screen reader.
- Multi-client ordering was simulated with a held browser response plus an independent same-page HTTP mutation and authoritative refresh, rather than two visible browser windows.
- No production build was run, as required by the approved plan and repository development instructions.
