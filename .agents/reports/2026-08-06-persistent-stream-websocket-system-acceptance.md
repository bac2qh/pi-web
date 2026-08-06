# Persistent-Stream WebSocket System Acceptance

Date: 2026-08-06

Master: `.agents/plans/2026-07-30-persistent-stream-websocket-migration.md`

S7: `.agents/plans/2026-08-06-s7-system-acceptance.md`

Checkpoint: `.agents/checkpoints/2026-08-06-s7-system-acceptance-checkpoints.md`

## Outcome

Pi Web's persistent global-status, session-event, and live-file delivery now uses same-port WebSockets. Ordinary commands, session reads, transcript/context repair, and non-watch file APIs remain HTTP. OAuth/device login retains the only intentional browser `EventSource`, and it is interactive rather than an ordinary persistent page stream.

The user accepts the integrated behavior from real-world use as the S7 human gate and directs closeout. This acceptance is practical, not a reconstructed claim that every exact formal S7 browser/load observation was recorded. The matching checkpoint contains the current complete-suite/static outcomes and the authoritative departure disposition.

## Retained evidence map

| Acceptance class | Retained evidence | Disposition |
|---|---|---|
| Global running/discovery socket, one per loaded page, replayed `sessions_changed`, no global SSE | S1 implementation/report `f0fc1ac7296065dfca0aeb0038e2b6e2ed04837a`; `.agents/reports/2026-08-01-s1-global-websocket-validation.md`; S1 final checkpoint `dbe3a52f925dac808d87750e188d1b7095e9afb1` | Accepted milestone evidence; current source/static checks repeated in S7. |
| True-delta projected protocol, monotonic sequence, bounded replay, canonical snapshot/finality | S2 implementation `39f22f0eafa418a3bac5e664b35764ff43213f27`; checkpoint `26ec788052fbd7297ffd787f4b71a1c993b72589` | Accepted protocol/unit/load evidence; exact S7 projected-byte observation not repeated. |
| Metadata-bound session ticket/channel, replay/recovery/backpressure, subscriber independence | S3 implementation `2f3eb50cb8b7ef0c8eef92097b9c5a6ce0a8b614`; checkpoint `43b9e0cc857f8ccd98082481a08f3ac2e72469af` | Accepted server/integration evidence. |
| Page registry, visible/hidden session views, reconnect/offline/reload/restart, ordinary HTTP responsiveness | S4A implementation/checkpoint `11036f6b2f829b7e27bad9e2fee4148d5925915d` / `598f804777132f049a88751becddef3e7d6b33f3`; S4B implementation/report/finality `80eea2247860241f0632cd1fc272d25ddcbbbe5b` / `.agents/reports/2026-08-02-s4b-browser-session-migration.md` / `2d37c9888c34b112d069f4093d69136543986079` | Accepted Chromium/Firefox milestone evidence; no exact combined S7 rerun inferred. |
| Authorized file-watch socket, all viewer variants, deletion/recreation, path/source changes, offline/restart, one watcher, OAuth-only EventSource inventory | S5 implementation/finality `e82e9bdc6c020d0663eec12515bf41c3aa5d6ad8` / `c7f4a4c3bf488c6ef6ad5da2caebc96cdc1c8174`; `.agents/checkpoints/2026-08-03-s5-persistent-file-watch-websocket-checkpoints.md` | Accepted Chromium/Firefox and filesystem milestone evidence; no combined S7 all-media run inferred. |
| 30-minute semantic idle, active protection, direct-peer admission, heartbeat, bounded output, exact ownership, ten-second shutdown | S6 implementation/finality `5565a2428fdaccb63b3a0c1e376060eea4919dc1` / `98cf3b76fe4e86ae14090cb90721c452e3ec4dad`; `.agents/checkpoints/2026-08-03-s6-lifecycle-security-shutdown-checkpoints.md` | Accepted lifecycle/security evidence and disclosed residuals. |
| Fresh production route inclusion and lifecycle | Production-route correction/finality `5dc645fe94000c328149cb6c7590a107959af0aa` / `473236c2eaa2c65f845b18c61974ab859488ea9e` | Fresh build, complete suite, package, and production launcher evidence recorded by its checkpoint. |
| Advancing-tip transcript repair and stale global running-status correction | `fd84e46f15d04ba3c0ed2bd58dcddc8c41ace71d` / `16bc179aaf1443f2685a97f197c0a8f7f9252ac6`; `e5dc92f58d10952e0ed28df698fea990463df96b` / `cc0b997e9206dca8a836ec18fd8f9de48a2b5461` | Later integrated corrections; current complete suite required by S7. |

## User acceptance

The user reports that actual testing is mostly working and explicitly authorizes:

- using that real-world testing as S7 user acceptance;
- recording every unproven formal S7 matrix item as an accepted departure;
- closing the master after bounded current validation;
- deleting only the retained orchestration checkout's task-local subagent/build/dependency state; and
- performing a distinct later non-force worktree/branch cleanup after successful guarded closeout.

No browser version, exact connection count, prompt count, provider mix, latency, transcript content, or visual result is inferred from that statement.

## Accepted S7 departures

The following exact S7 evidence was not reconstructed and is accepted as incomplete rather than reported as passing:

1. A new S7-specific Firefox and Chromium 1/5/10-page inventory.
2. Exact 1/7/10 aggregate session subscriptions.
3. One combined 10-page + 10-session + 10-mounted-file-viewer topology with exactly 30 admitted Pi Web sockets.
4. Measured 5-page/7-run ordinary and 10-page/10-run stress HTTP schedulability and responsiveness.
5. One combined run spanning visible/hidden retry, queue, compaction, navigation, background/foreground, offline/online, refresh, and restart.
6. One combined all-media file-viewer change, deletion/recreation, reconnect, path/source change, and teardown run.
7. One complete rich Markdown, code, math, Mermaid, tools, extension UI, branch/fork/clone, models/auth/config, files/worktrees/export, sound, and hosted-discovery visual/capability matrix.
8. S7-specific projected-byte and owned-resource-cleanup observations beyond accepted milestone and automated evidence.

These departures do not erase the narrower real Firefox/Chromium and lifecycle evidence mapped above. They prevent stronger aggregate claims.

## Residual boundaries

- Final-component symlink watching retains the original OS-dependent one-direct-watcher behavior accepted in S5.
- If an SDK-provided unsubscribe callback itself throws, wrapper/generation cleanup may remain incomplete until process exit; normal unsubscribe remains invoked.
- Arbitrary corruption/replacement of private running-projection globals and synthetic recursive publisher behavior are unsupported internal cases accepted at S6.
- Later unrelated feature work is outside this acceptance report and must not be merged or deleted by this closeout.

This report contains only commits, paths, bounded outcomes, and departure classes. It intentionally contains no prompts, session identifiers, tickets, provider payloads, credentials, private file names, or transcript content.
