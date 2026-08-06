# S7 System Acceptance Boundary Checkpoints

Plan: `.agents/plans/2026-08-06-s7-system-acceptance.md`

## Handoff

**Source:** User direction in the original planning/launcher conversation on 2026-08-06.

**Purpose:** Resolve the S7 human-acceptance and cleanup boundary after accepted S1-S6 were integrated early into local main.

**Outcome:** The user states that real-world testing is mostly working and explicitly directs the root to close the master using that testing as S7 user acceptance, record every unproven formal S7 matrix item as an accepted departure, and permanently delete the retained orchestration checkout's task-local subagent/build/dependency artifacts. The user separately authorizes later non-force worktree and branch cleanup after successful S7 acceptance and ordinary guarded closeout; cleanup is not part of this milestone or closeout.

**Evidence:** Direct user instruction in the controlling conversation. Git preflight independently proved orchestration tip `91c8c1df90ce4733431056679a78c0b7f8195f74` is an ancestor of latest local main `08f49cf714b6ada490bda3ded3b4c7a69d80d297`; the retained checkout had no tracked changes. The explicitly authorized local-only `.pi-subagents`, `.next`, `node_modules`, `next-env.d.ts`, and `tsconfig.tsbuildinfo` state was deleted, the checkout became clean including ignored state, and its branch was fast-forwarded to latest local main.

**Uncertainty / gaps:** The user's testing does not establish exact browser/page/session/socket counts, browser versions, timing, provider mix, or complete visual/capability coverage. Those facts must not be inferred. Another registered worktree contains unrelated active changes, so final main integration needs a repeated race/overlap preflight.

**Recommended use:** Complete the bounded automated/static S7 evidence and required maintained documentation, record exact departures, commit S7, perform separate full-master validation, and use guarded closeout only if current source and Git checks pass. Only after successful closeout may the original launcher session run the separately authorized cleanup eligibility checks and non-force removal.

## Handoff

**Source:** Fresh read-only `reviewer` result returned in the controlling launcher-session transcript immediately before S7 approval; no-edit and no-delegation constraints.

**Purpose:** Challenge the final S7 draft for exact retained-evidence provenance, literal command syntax and expected outcomes, complete accepted-departure classes, documentation obligations, six-file scope, and separation among S7, full-master validation, closeout, and later cleanup.

**Outcome:** Verdict `READY`. After three sequential review/fix passes, the reviewer found no remaining blocker. It accepts the exact implementation/checkpoint/report commit inventory, literal current-baseline commands and timing, explicit unproven browser/load/visual classes, mandatory AGENTS/memory/log/report updates, five post-plan acceptance paths within the six-file total scope, privacy boundary, and retained-worktree closeout rule.

**Evidence:** The root incorporated every prior finding: S2/S3/S4A and post-S6 commits/checkpoints are named exactly; automated, Git, source, and package checks have literal commands and expected outcomes; S1/S4B/S5/S6 evidence must be mapped rather than rediscovered; documentation is required rather than waived; and worktree removal is reserved for a distinct post-closeout cleanup action.

**Uncertainty / gaps:** Review is plan-only and ran no implementation tests. The exact S7 formal browser/load classes remain intentionally unproven and must be listed as accepted departures rather than pass claims.

**Recommended use:** Approve and commit the S7 plan/checkpoint boundary, then execute its evidence-only contract without implementation-source edits.

## Handoff

**Source:** Orchestration-root S7 validation on exact task source synchronized from local main `08f49cf714b6ada490bda3ded3b4c7a69d80d297`; Mode: validation.

**Purpose:** Execute S7-VC-001 through S7-VC-007 without implementation-source edits and distinguish source failures from checkout/runtime-environment failures.

**Outcome:** Current integrated source passes. The exact orchestration-checkout suite passed 679/679 with zero failures, cancellations, skips, or todos after unsetting inherited `NODE_ENV=production` and temporarily linking the already validated main `node_modules` and `.next` runtime; both links and all generated task-local `.next`, `next-env.d.ts`, and `tsconfig.tsbuildinfo` state were removed afterward. TypeScript passed, ESLint passed with zero warnings, package dry run listed nine files with zero `.next/dev`, `.next/cache`, or JavaScript source-map entries, both whitespace checks passed, all required ancestry checks passed, and the production source inventory found only `components/ModelsConfig.tsx` constructing `EventSource`, both agent SSE routes absent, no file-viewer SSE/watch query, no private Next/Watchpack/active-handle source match, and exactly three production channel registrations.

**Evidence:** Root logs are transient under `/tmp/pi-web-s7-*` and contain test/command output only. The first literal task-suite attempt is rejected evidence: inherited `NODE_ENV=production` selected production React without `act`, and user-authorized deletion left the task checkout without the runtime paths required by the copied-production test. A main-source rerun proved 679/679; the decisive exact-task-source rerun then proved 679/679 with only temporary runtime links. `HEAD` was S7 plan commit `2859d1e500165ec882aef4062549cde703a7db1a`, local main was `08f49cf714b6ada490bda3ded3b4c7a69d80d297`, divergence was `0 1`, and every orchestration/S6/post-S6 correction commit named by the plan was an ancestor. Before checkpoint update, the only changed paths were the four approved documentation/report paths.

**Uncertainty / gaps:** No new formal browser/load run was fabricated. The eight exact S7 evidence classes listed in the report remain accepted departures. The temporary runtime links reused the already validated local-main dependency and production artifact at identical implementation source; they do not claim a new build.

**Recommended use:** Obtain fresh independent no-edit review of the exact diff and evidence, append its disposition, then commit the bounded S7 acceptance paths.

## Handoff

**Source:** Fresh read-only `reviewer` result returned in the controlling launcher-session transcript after root validation; no-edit and no-delegation constraints; Mode: review.

**Purpose:** Independently scrutinize the S7 documentation/report diff, source truth, retained evidence, privacy, accepted departures, test-environment correction, and boundary among S7, full-master validation, closeout, and cleanup.

**Outcome:** Verdict `READY`; no blocker. The reviewer confirms the unstaged inventory was exactly the four then-authorized paths, all three static production registrations and the OAuth-only EventSource boundary match source, report commits are real ancestors, all eight unproven classes are explicit, memory is chronological, the log is append-only, changed content is privacy-safe, and no implementation-source defect is indicated by the rejected first test attempt. It independently confirms task-local `node_modules` and `.next` are absent after the successful 679/679 exact-source rerun.

**Evidence:** Reviewer mapped current guidance to `AGENTS.md`, registrations in `lib/global-status-channel.ts`, `lib/session-channel.ts`, and `lib/file-watch-channel.ts`, OAuth at `components/ModelsConfig.tsx`, and exact report/memory lines. It accepted the disclosed environment correction: production React lacked `act` only because the parent environment exported `NODE_ENV=production`, while the copied-production fixture also required the deliberately deleted task runtime; clean-environment validation passed without source changes.

**Uncertainty / gaps:** This verdict accepts the S7 evidence boundary only. It does not perform or replace the master's separate full-master validation, guarded closeout, or cleanup.

**Recommended use:** Record exact departures and commit S7 without source changes.

## Implementation Summary

**Plan section:** S7 Objective, Design / Implementation Strategy, and S7-VC-001 through S7-VC-007.

**Work and outcome:** Accepted the user's real-world testing as the S7 human gate; reconciled exact retained S1-S6 and post-S6 correction evidence; updated current-state transport guidance, durable lifecycle memory, append-only memory history, and one bounded acceptance report; and revalidated the exact latest integrated implementation without changing source. Persistent global/session/file delivery is WebSocket-based and short-lived OAuth login remains the sole browser EventSource.

**Validation / evidence:** Exact task-source suite 679/679; TypeScript pass; ESLint pass with zero warnings; package dry run nine files and zero forbidden generated/source-map entries; Git ancestry, whitespace, path, and source inventories pass; independent review verdict `READY`; practical user acceptance recorded without invented details. The rejected initial test attempt and its clean-environment/runtime-link correction are disclosed in the preceding handoff.

**Departures from approved obligations:** User-accepted S7 departures: no new exact Firefox/Chromium 1/5/10-page inventory; no exact 1/7/10 aggregate session inventory; no combined 30-socket topology; no measured 5-page/7-run and 10-page/10-run schedulability/responsiveness run; no single combined visible/hidden retry/queue/compaction/navigation/background/offline/refresh/restart run; no single combined all-media file-viewer lifecycle run; no complete rich visual/capability matrix; and no S7-specific projected-byte/owned-resource observation beyond retained evidence. Existing narrower milestone evidence remains valid. No documentation, source, privacy, or cleanup obligation is silently waived.

**Implementation commit:** Integrated implementation baseline `08f49cf714b6ada490bda3ded3b4c7a69d80d297`; S7 evidence commit pending.

## Implementation Summary

**Plan section:** S7 committed finality boundary before separate full-master validation.

**Work and outcome:** S7 is accepted. Evidence commit `47b919c7e20c3e07a562050300c3965e8a4bc3af` contains the bounded current-state guidance, transport memory/log update, system-acceptance report, and pre-commit checkpoint evidence. It changes no implementation source and retains the orchestration worktree/branch for the master's separate validation and closeout.

**Validation / evidence:** Exact task-source 679/679, TypeScript, zero-warning ESLint, package dry run, whitespace, ancestry, path, source inventory, practical user acceptance, and fresh independent `READY` review all passed as recorded above. The evidence commit's cached paths were exactly the five approved post-plan S7 paths and no S7 change remained unstaged.

**Departures from approved obligations:** The eight user-accepted formal S7 evidence departures remain exactly those enumerated in the preceding summary and acceptance report: exact new 1/5/10-browser, 1/7/10-session, combined 30-socket, 5/7 and 10/10 responsiveness, combined session-recovery, combined all-media file lifecycle, complete rich visual/capability, and S7-specific byte/resource-observation evidence. No other obligation is incomplete, blocked, waived, superseded, or divergent at the S7 boundary.

**Implementation commit:** S7 evidence `47b919c7e20c3e07a562050300c3965e8a4bc3af`; integrated source baseline `08f49cf714b6ada490bda3ded3b4c7a69d80d297`.

## Handoff

**Source:** Fresh read-only `reviewer` result returned in the controlling launcher-session transcript after S7 finality `c31ee36d937a1ae25fffbde1b9e085ebe7ef6fc4`; no-edit and no-delegation constraints; Mode: full-master validation review.

**Purpose:** Independently validate the complete repository result against ORCH-VC-001 through ORCH-VC-013, all retained milestone/correction evidence, current source, explicit user departures, privacy, finality sequencing, and ordinary closeout readiness.

**Outcome:** Verdict `READY`; no source or retained-evidence blocker. ORCH-VC-012 and ORCH-VC-013 pass. ORCH-VC-001 through ORCH-VC-011 are accepted with their explicit existing or user-authorized departures rather than overstated as unconditional passes. The reviewer confirms current production route exports, live-tip reconciliation, receipt-aware running finality, three production WebSocket registrations, 30-minute idle, heartbeat/grace, OAuth-only EventSource inventory, documentation, and 679/679 integrated validation all agree.

**Evidence:** The review mapped every master validation ID to committed S1-S7 plans/checkpoints/reports and actual source. It independently verified S7 finality `c31ee36d937a1ae25fffbde1b9e085ebe7ef6fc4`, clean task status, `main...HEAD` divergence `0 3`, and ancestry of all required implementation/correction commits. It found no migration-source mutation after the validated integrated baseline.

**Uncertainty / gaps:** The eight S7 formal evidence gaps remain accepted departures. Earlier dispositions also remain visible: the S1 real distributed four-address 256/257 integration waiver; S6's accepted throwing-SDK-unsubscribe residual and unsupported private running-global corruption/recursive-publisher cases; and the user-directed interim S1-S6 main integration before S7. Later session-removal and other independently approved main work are outside migration attribution and must not be reverted.

**Recommended use:** Commit the mandatory final full-master summary, then perform fresh guarded main/task status, overlap, Git-operation, ancestry, and race/mutex preflight. Retain the task worktree/branch during closeout; run separately authorized cleanup only after closeout succeeds.

## Implementation Summary

**Plan section:** Master `Full-master validation and ordinary closeout`; Objective and ORCH-VC-001 through ORCH-VC-013.

**Work and outcome:** Full-master validation completed at task tip `c31ee36d937a1ae25fffbde1b9e085ebe7ef6fc4` over the integrated implementation baseline `08f49cf714b6ada490bda3ded3b4c7a69d80d297`, accepted S1-S7 evidence, current source, and all post-S6 corrections. No source blocker was found. Global status, projected session delivery, and live-file watch use same-port bounded WebSockets; HTTP command/reconciliation APIs and transient OAuth SSE remain as designed; current documentation and durable memory match implementation.

**Validation / evidence:** Exact integrated task-source suite 679/679; TypeScript pass; ESLint pass with zero warnings; package dry run nine files/zero forbidden entries; whitespace, ancestry, path, route, EventSource, channel-registration, and private-Next inventories pass; production build/route/package/restart evidence retained at `473236c2eaa2c65f845b18c61974ab859488ea9e`; practical user acceptance; independent full-master review verdict `READY`. ORCH-VC-012 and ORCH-VC-013 pass; every other ID is dispositioned below with accepted evidence and departures.

**Departures from approved obligations:** User-accepted S7 evidence departures: no new exact Firefox/Chromium 1/5/10-page inventory; no exact 1/7/10 aggregate-session inventory; no combined 30-socket topology; no measured 5-page/7-run and 10-page/10-run responsiveness run; no single combined session-recovery matrix; no single combined all-media file lifecycle matrix; no complete rich visual/capability matrix; and no S7-specific projected-byte/owned-resource observation beyond retained evidence. Earlier accepted dispositions: S1's real distributed four-address 256/257 integration is waived while deterministic total-cap and real per-peer evidence pass; S6 retains the residual that a throwing SDK unsubscribe may interrupt cleanup and treats private running-global corruption/synthetic recursive publishers as unsupported; S1-S6 were integrated before S7 by explicit user sequencing override. The first S7 task-suite attempt was rejected because inherited `NODE_ENV=production` and intentionally deleted task runtime invalidated the harness; clean-environment exact-task-source validation passed 679/679 with temporary runtime links removed. No other obligation is incomplete, blocked, waived, superseded, or divergent.

**Implementation commit:** Validated integrated source baseline `08f49cf714b6ada490bda3ded3b4c7a69d80d297`; S7 evidence `47b919c7e20c3e07a562050300c3965e8a4bc3af`; S7 finality `c31ee36d937a1ae25fffbde1b9e085ebe7ef6fc4`.
