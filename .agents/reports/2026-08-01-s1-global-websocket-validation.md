# S1 Global WebSocket Validation

Date: 2026-08-01

Governing milestone: `.agents/plans/2026-07-31-s1-global-running-websocket.md`

Narrow waiver authority: local-main commit `8f7ded851e1241ee81631d49f443091f1e02bb49`

## Evidence boundary

This report records aggregate, synthetic validation only. It contains no peer address, interface inventory, ticket, query URL, session identifier, prompt/provider payload, credential, content from an existing session, or private filesystem path.

The approved follow-up waives only the real distributed four-address 256/257 integration. Production limits remain 64 Pi Web WebSockets per direct peer and 256 total. Pure 256/257 accounting and every other S1 gate remain required.

## Automated gates

| Gate | Result |
|---|---:|
| TypeScript | Pass |
| Lint | Pass |
| Focused S1 suite | 85 passed; 0 failed/skipped |
| Full suite excluding the separately exercised real-Next file | 224 passed; 0 failed/skipped |
| Real-Next lifecycle/HMR suite using the pinned cached production fixture | 4 passed; 0 failed/skipped |
| Package dry run and changed runtime inclusion | Pass |
| Diff check | Pass |
| Migrated global EventSource inventory | 0 caller; route absent |
| Retained EventSource inventory | 1 per-session; 4 file-watch; 1 short-lived OAuth |
| Staged files during validation | 0 |

The literal full-suite command first produced 226 passes and two nested failures solely because local main no longer contained the stale production `BUILD_ID`/manifest fixture expected by the release-owned production-lifecycle preflight. No source assertion failed. The tests were then partitioned without skips: all 224 non-real-Next tests passed, and all four real-Next tests passed against the already cached published Pi Web 0.7.16 artifact with the required Next 16.2.11 manifests. The fixture was isolated under temporary storage, used no network fetch, and validated lifecycle only; it does not claim fresh route inclusion or replace the prohibited development `next build`.

## Browser harness

The root used an untracked temporary harness and an owned development server child. Each run used an isolated temporary home, Pi config/session directory, and cwd. A temporary global extension supplied local command-only running holds and exercised both hosted launch kinds without provider calls. The child environment excluded provider credentials. Cleanup stopped the owned server and browsers and removed the temporary fixture.

- Chromium-family automation used the already installed Playwright browser/API without adding a project dependency.
- Firefox automation used the installed system Firefox through its built-in loopback-only WebDriver BiDi endpoint; no driver/browser installation was needed.
- The harness recorded only aggregate counters. It classified `/_pi/websocket` separately from development HMR and retained no full URL or ticket.
- No privileged operation, host-network mutation, provider request, or existing user session was used.

### Page inventory

| Engine | Top-level pages | Active Pi Web global sockets | Maximum per page | Global EventSources/requests |
|---|---:|---:|---:|---:|
| Chromium | 1 | 1 | 1 | 0 |
| Chromium | 5 | 5 | 1 | 0 |
| Chromium | 10 | 10 | 1 | 0 |
| Firefox | 1 | 1 | 1 | 0 |
| Firefox | 5 | 5 | 1 | 0 |
| Firefox | 10 | 10 | 1 | 0 |

### Restart/reconnect

For each engine, five loaded pages remained open while the owned development server process stopped and restarted on the same port. All five pages detected a new server namespace, replayed discovery, reloaded the session list, and converged to five active Pi Web sockets with a maximum of one per page. No global EventSource appeared and no synthetic running-to-idle transition was observed from transport loss.

### Hosted discovery

For each engine, five loaded pages observed one synthetic hosted `start` and one synthetic hosted `orchestrate` launch through the real process capability. Every page received both discovery changes, reloaded the session list for both, and observed running-to-idle settlement. The capability reused an already published exact owner, matching the supported browser-startup-won race path. No provider call was made.

### Workload and HTTP completion

| Engine | Pages | Concurrent local runs | Pages seeing all runs and settlement | Ordinary HTTP | Diagnostic completion class |
|---|---:|---:|---:|---:|---:|
| Chromium | 5 | 7 | 5 | 7/7 completed | under 1 second |
| Chromium | 10 | 10 | 10 | 10/10 completed | under 1 second |
| Firefox | 5 | 7 | 5 | 7/7 completed | under 1 second |
| Firefox | 10 | 10 | 10 | 10/10 completed | under 1 second |

All pages retained exactly one global Pi Web socket while the ordinary HTTP requests completed. Every page observed a positive running set, the complete aggregate run count, and the later idle transition. Every page persisted the expected unread-session set after background completion.

The isolated synthetic command-only sessions did not render as ordinary sidebar session rows, so this run does not claim a visual unread-dot observation. Executable component tests cover the indicator rendering and transition policy; subjective visual acceptance remains the S7 user gate. This limitation does not conceal a dropped transition: per-page protocol transitions and persisted unread counts both matched the synthetic run set.

## Residual evidence boundary

- The real distributed 256/257 Node upgrade test is explicitly waived, not passed.
- Pure 256/257 accounting, real 64/65, malformed-handshake release, exact ordering, ticket non-reuse, subscriber cleanup, and capacity re-admission remain passing.
- Fresh production route inclusion remains release-workflow evidence because `next build` is prohibited during development.
- S7 still owns the combined 30-socket topology, rich visual/capability matrix, provider-backed/user responsiveness evaluation, and final user acceptance.
