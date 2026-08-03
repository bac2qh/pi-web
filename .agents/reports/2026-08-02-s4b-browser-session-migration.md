# S4B Browser Session Migration Evidence

Executed: 2026-08-03

Governing plan: `.agents/plans/2026-08-02-s4b-hook-migration-hidden-streams.md`

## Scope

This report records the sanitized real-browser acceptance evidence for the S4B migration from per-session EventSource delivery to the page-owned session WebSocket registry. It covers the S4B browser boundary only. File-watch WebSockets remain S5; combined ten-page scale, rich visual/user acceptance, and final capability acceptance remain S7.

The tests used disposable synthetic sessions and the configured authenticated default model against the Pi Web custom development server. Evidence contains only counts, finite outcomes, and transport classes—no session IDs, tickets, prompts, responses, provider payloads, credentials, or private paths.

## Browser matrix

| Browser | Version | Result | Provider completions | Initial/final Pi Web sockets | Agent EventSources |
|---|---:|---|---:|---|---:|
| Chromium | 149.0.7827.55 | Pass | 5/5 | 1 global + 1 selected session | 0 |
| Firefox | 153.0.1 | Pass | 5/5 | 1 global + 1 selected session | 0 |

Each development page also had one Next development/HMR WebSocket. It is not a Pi Web transport channel and is excluded from the Pi Web topology count.

## Behaviors proved in both browsers

- Existing-session initial load reached one global running/discovery socket and one selected-session socket.
- A newly ensured native session obtained its ticket and reached S3 ready/canonical snapshot before its first HTTP prompt.
- Selection moved away before the new session's first projected activity. The locally claimed session remained current without any abort or Stop command, completed through the hidden connection, released when settled, and converged when revealed.
- Rapid hidden/reselection preserved the same session and produced another persisted assistant completion.
- Forced session-socket loss reissued a one-use ticket, opened one replacement socket, and converged without stopping server work.
- Offline/online recovery completed during provider activity. Chromium used browser-context offline mode plus explicit loss of the existing socket; Firefox used WebDriver BiDi offline network emulation plus explicit loss of the existing socket. Both recovered after online restoration.
- A browser reload during provider activity recovered the selected session and final persisted transcript.
- A full Pi Web development-server restart reconnected both the global and selected-session sockets while preserving ordinary HTTP access.
- Concurrent `/api/models`, `/api/sessions`, and applicable file/session reads remained responsive while persistent sockets were active.
- Five accepted provider prompts produced five persisted assistant messages in the migrated session.
- No page error class was observed in Chromium; Firefox BiDi commands and page predicates completed without script exceptions.
- No browser request used `/api/agent/[id]/events`, and no agent EventSource was constructed.

Chromium additionally completed the current `/clone` and `/compact` command-dispatch waits before server restart. Focused mounted and full automated suites remain the authoritative detailed coverage for branch/fork/clone, queue/retry, compaction, tools, extension UI, draft/image ownership, and stale HTTP/run/leaf behavior.

## Sanitized connection and recovery evidence

### Chromium

- Final active Pi Web sockets: global `1`, session `1`.
- Global tickets across reload/restart: `2`.
- Session tickets across selection/recovery/reload/restart: `9`.
- Session sockets opened across the flow: `8`; observed closures before replacement: `6`.
- Prompt HTTP outcomes: `5` successful, `0` failed.
- Ensure HTTP outcomes: `1` successful, `0` failed.
- Abort/Stop requests caused by selection: `0`.
- Final persisted assistant count: `5`.

### Firefox

- Final active Pi Web sockets: global `1`, session `1`.
- Global tickets across reload/restart: `2`.
- Session tickets across selection/recovery/reload/restart: `9`.
- Session sockets opened across the flow: `7`; observed closures before replacement: `5`.
- Prompt HTTP outcomes: `5` successful, `0` failed.
- Ensure HTTP outcomes: `1` successful, `0` failed.
- Abort/Stop requests caused by selection: `0`.
- Final persisted assistant count: `5`.

The summed pre-/post-document instrumentation counters are not concurrent socket counts. The decisive topology is the per-document initial/final inventory: exactly one global Pi Web socket and one selected-session Pi Web socket.

## Defect and rerun disposition

The first Chromium rerun exposed a real S4B integration defect: `ensure_session` returned a native ID, but the session ticket required a persisted/discoverable header, while the browser correctly waited for ticket-ready before sending the first prompt. A direct sanitized probe observed ensure `200`, pre-prompt ticket `404`, and ticket success only after prompt persistence. The bounded fix now authorizes only an explicitly marked, exact current live native owner using immutable manager-derived ID/file/cwd and compatible hub identity. Follow-up fixes added collision-resistant request keys and exact failed-ensure owner/cache cleanup with replacement safety.

The complete correction passed repeated root inspection and final independent review `70c56bcf-d54c-4a96-8e58-66263c932863`. The final Chromium and Firefox runs above then passed the formerly blocked first-prompt flow.

Several rerun failures were harness-only and were corrected without project-source changes: active work must be read from state flags rather than wrapper existence; repeated synthetic labels required per-run uniqueness; and browser offline emulation does not itself guarantee that an already-open WebSocket closes, so the test explicitly paired offline mode with socket loss. No acceptance claim relies on those failed harness attempts.

## Remaining boundaries

- This was headless functional/network acceptance, not rich visual or user responsiveness acceptance.
- File viewers were not mounted; their four persistent EventSources intentionally remain for S5.
- OAuth login was not invoked; its short-lived EventSource remains the explicit exception.
- Fresh production route inclusion remains release-owned because `.next/BUILD_ID` is absent and `next build` is prohibited during development.
- S7 retains combined 30-socket scale, full rich rendering/capability matrix, and final user acceptance.
