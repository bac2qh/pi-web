# Existing-Session Effort Selection Checkpoints

Plan: `.agents/plans/2026-08-22-existing-session-effort-selection.md`

## Implementation Summary

**Plan section:** Objective; Design / Implementation Strategy; Test Strategy; Validation Contract VC-001 through VC-005.

**Work and outcome:** Added one shared existing-file startup resolver in `lib/rpc-manager.ts`. It first proves an active-path native `thinking_level_change` exists, uses `buildSessionContext()` for final active-path and message-presence semantics, validates the final value against `off | minimal | low | medium | high | xhigh | max`, and supplies a valid message-free result through the SDK's `thinkingLevel` factory option before wrapper publication. New sessions do not consult the resolver; populated sessions keep native restoration; absent and malformed declarations keep defaults; explicit `off` remains distinct from absence. The hosted capability request, model/tool/extension/side policy, identity checks, ownership lock, publication timing, kickoff, and shutdown paths are unchanged. Maintained hosted-startup documentation and durable memory now record the boundary.

**Validation / evidence:** A deterministic custom model supporting `xhigh` and `max` proved effective `xhigh` in both prepared and published owners while the fixture global remained `max`, before any provider turn. Resolver coverage proves last-active-value selection, an abandoned branch, explicit `off`, absence, malformed final values, and populated contexts. Real startup coverage proves SDK-owned message-free model/thinking appends, no Pi-Web-owned entry, unchanged settings bytes, unchanged populated restoration, unchanged new-session defaults, and hosted-first/browser-first convergence on one owner with one provider-free kickoff at `xhigh`. Final validation passed: `NODE_ENV=test PI_CODING_AGENT_DIR=<disposable> node --test lib/rpc-manager.test.mjs` (160/160), `../../../node_modules/.bin/tsc --noEmit`, `npm run lint`, and `git diff --check`. No `next build` was run.

**Departures from approved obligations:** None. The typecheck used the repository-prescribed retained-main dependency installation because the nested task worktree intentionally has no local `node_modules`.

**Implementation commit:** Pending.

## Implementation Summary

**Plan section:** Final implementation and Validation Contract closeout — Objective; Design / Implementation Strategy; VC-001 through VC-005.

**Work and outcome:** Completed the approved existing-session startup adapter. A valid final active-path effort declaration on an existing message-free target is now authoritative during SDK construction and therefore effective before publication and hosted kickoff. Explicit `off`, active-branch last-value semantics, malformed-final rejection, same-ID hosted/browser ownership, SDK-owned initialization entries, native populated-session restoration, new-session defaults, model/tools/extensions, side policy, identity validation, global settings, and the six-field hosted request all retain their required boundaries. Maintained architecture and durable hosted-session history match the implemented behavior.

**Validation / evidence:** The final disposable-agent-directory RPC run passed 160/160, including deterministic prepared/published `xhigh`, resolver matrix, negative/default/restoration fixtures, and both hosted/browser race orderings with one owner and one provider-free kickoff. TypeScript (`../../../node_modules/.bin/tsc --noEmit`), ESLint (`npm run lint`), and `git diff --check` passed. The implementation, tests, documentation, memory, and initial checkpoint record are committed as `74925168c387830572d72c293743ac2133431dfc` (`fix: restore saved effort for empty sessions`). No production build ran and no temporary fixture state remains.

**Departures from approved obligations:** None. VC-001 through VC-005 are complete. The SDK's pre-existing standard model/thinking append for message-free construction remains intentionally unchanged, as required by the plan.

**Implementation commit:** `74925168c387830572d72c293743ac2133431dfc`.
