# Pin Pi Web to Node 22.23.2 — Checkpoints

Plan: `.agents/plans/2026-09-02-pin-node-22-runtime.md`

## Handoff

**Source:** Read-only scout workflow `f626fe03-b17a-43ad-8cff-eae065343671`, child `9653be40`; recoverable summary `.pi-subagents/artifacts/outputs/9653be40/context.md` and run metadata under the workflow artifact directory.

**Purpose:** Reconfirm the approved implementation seams, launcher startup ordering, npm-version observation, test fixtures, documentation conflicts, and preserved local-fork boundary before editing.

**Outcome:** The scout confirmed that the shared CommonJS checker belongs under published `bin/`; imported `runPiWebCli()` must check before option parsing or environment/resource work; the terminal main path must check before `runTerminalEntry()` installs signal listeners; `predev`, `prebuild`, and `prestart` are the only ordinary lifecycle hooks; and the real-Next fake launcher fixture must copy the new checker. It recommended fixed `npm --version` execution with no shell or caller-provided version text, strict bounded sanitization, and literal recovery commands. It also identified the English and Chinese development docs plus `AGENTS.md` as currently conflating the ordinary and fork-reconstruction toolchains.

**Evidence:** The handoff cites `package.json`, `bin/pi-web.js`, `lib/pi-web-launcher.test.mjs`, `lib/pi-web-real-next.test.mjs`, `scripts/build-local-pi-fork.mjs`, both README files, `AGENTS.md`, and durable memory with line-specific findings. It independently confirmed the fork identity/integrity and that Next and Pi engine ranges accept Node 22.23.2. Parent inspection confirmed the decisive launcher, package, fork-helper, test, and documentation seams.

**Uncertainty / gaps:** The scout did not implement or validate changes. Its suggested memory update and Chinese documentation update remain subject to parent scope judgment. Full disposable install/build/lifecycle evidence and live-state preservation checks remain outstanding.

**Recommended use:** Implement the minimal published checker and exact entrypoint hooks, update every maintained setup surface that would otherwise contradict the split toolchains, preserve the lockfile and fork helper bytes, then run focused review and the approved disposable validation contract.

## Handoff

**Source:** Fresh read-only review workflow `76c5c90f-2820-40b7-b15e-0c30a263dc1c`, correctness child `e5a2ae15` and Validation Contract child `0811ba8b`; recoverable aggregate result in the workflow `status.json` under its async artifact directory.

**Purpose:** Independently review the uncommitted implementation for runtime/npm guard bypasses, early-start ordering, bounded diagnostics, packaging, documentation, scope containment, and readiness for VC-001 through VC-006.

**Outcome:** Both reviewers identified the same required VC-001 defect: imported `runPiWebCli()` checked injectable `options.process.version` instead of the actual `process.version`, allowing a fake exact version to start the injected server under Node 24. The correctness reviewer additionally identified a required npm-invocation defect: the hook checked a fresh PATH-resolved `npm --version`, so npm 11 could invoke the lifecycle while the hook observed npm 10 on PATH and accepted it. Parent isolated reproductions confirmed one injected server start under actual Node `v24.20.0`, and confirmed invoking npm `11.19.0` was accepted when the hook's PATH probe saw npm `10.9.8`. Review otherwise accepted the terminal-before-signal-listener ordering, bounded privacy-safe diagnostics, published CommonJS placement, exact declarations/hooks, fork/lock containment, and documentation split.

**Evidence:** `bin/pi-web.js` imported guard near `runPiWebCli()`; `bin/pi-web-toolchain.js` PATH npm probe and lifecycle assertion; the exact review outputs in workflow `76c5c90f-2820-40b7-b15e-0c30a263dc1c`; parent child-process reproductions using no real server, Tailscale, user Pi state, or provider. Disposable validation completed after the reviewers' snapshot—Node 22/npm 10 install, focused 36/36, non-real suite 1002/1002, TypeScript, lint, build after clearing an inherited bundler variable, real-Next 5/5, full 1007/1007, and final production HTTP/WebSocket/session-refusal close/restart smoke—but those results cover the defective revision and cannot close VC-001.

**Uncertainty / gaps:** The exact npm-invocation observation implementation remains to be chosen within the approved boundary; it must bind to the invoking npm without echoing or trusting arbitrary version text, fail closed on malformed/unavailable identity, and remain bounded. Every affected focused and disposable validation must be rerun after correction. Final live-state comparison, implementation/final-summary commits, and guarded integration remain pending.

**Recommended use:** Wait for explicit user direction as required after an independent review finds unmet approved obligations. Recommended correction is to assert actual `process.version` before reading injected launcher options, and bind npm validation to a bounded validated invoking-CLI identity (for example `npm_execpath` executed with `process.execPath`, fixed `--version`, `shell: false`, bounded output/timeout, and no path or stderr disclosure), with adversarial regressions for both bypasses; then rebuild the disposable copy and rerun the Validation Contract.

## Handoff

**Source:** Final fresh read-only review workflow `7940025e-88f0-4ee5-a444-f2c4684290b1`, reviewer run `b6a122e3`; recoverable session artifact recorded by the workflow status.

**Purpose:** Re-review the corrected uncommitted implementation against the approved plan, with independent adversarial probes for both previously confirmed VC-001 bypasses and inspection of early startup ordering, bounded diagnostics, packaging, fixture coverage, fork/lock containment, and maintained documentation.

**Outcome:** The reviewer reported no blocker and no optional finding. It confirmed that imported startup checks actual `process.version` before reading injected options, so an actual Node 24 probe with a fake exact injected version rejected with zero option reads, resource starts, or signal-listener touches. It also confirmed that lifecycle validation executes the absolute invoking `npm_execpath` with the current Node rather than probing PATH, so npm 11 invoking a lifecycle while PATH exposed npm 10 rejected. Terminal ordering, fixed bounded diagnostics, exact declarations/hooks, published `bin/` coverage, the real-Next fixture, unchanged fork/lock/Serve surfaces, and the English/Chinese/agent documentation split were accepted.

**Evidence:** The reviewer cited `bin/pi-web.js:107-109,302-305,336-350`, `bin/pi-web-toolchain.js:11-37,64-130`, `lib/pi-web-toolchain.test.mjs:203-235`, `lib/pi-web-real-next.test.mjs:250-269`, `mise.toml`, `package.json`, and the maintained documentation. Its own exact-Node focused run passed 36/36, its actual-Node-24 injected-options probe touched no startup seam, its mixed npm 11/PATH npm 10 lifecycle probe rejected the invoking npm, and its scoped hash/diff checks found no preserved-surface drift or staged files.

**Uncertainty / gaps:** The reviewer did not independently repeat the complete clean disposable install/build/full-suite/production-lifecycle validation or the protected live-state comparison; it accepted the parent's supplied results for those gates. Residual product risk remains unchanged: Node 22 removes one known Node 24 retention factor but does not fix separate Next, Pi, full-history, or roughly 4 GiB heap-ceiling risks. Nonstandard npm launchers without a canonical absolute `npm_execpath` intentionally fail closed.

**Recommended use:** Treat both prior blockers as closed. Preserve the reviewed source, record the already completed corrected disposable validation and final protected-state checks, then create the implementation commit and proceed through the required final-summary commit and guarded local-main integration.
