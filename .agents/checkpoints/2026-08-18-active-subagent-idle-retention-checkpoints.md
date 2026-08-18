# Extend Pi Web Session Idle Retention Checkpoints

Plan: `.agents/plans/2026-08-18-active-subagent-idle-retention.md`

## Implementation Summary

**Plan section:** Objective; Design / Implementation Strategy items 1–6; Test Strategy; Validation Contract VC-001 through VC-004.

**Work and outcome:** Changed the one exported normal-wrapper semantic-idle default from `30 * 60 * 1000` to the fixed `12 * 60 * 60 * 1000` expression. Updated the exact-default test name and assertion while retaining its injected 30 ms fake-clock boundary and all existing lifecycle coverage. Updated `AGENTS.md`, durable custom-server lifecycle memory, and the append-only memory log to record the 12-hour default and preserve the earlier 30-minute decision as superseded history. No timer behavior, touch category, active-work claim, shutdown path, browser protocol, dependency, configuration surface, or Pi Subagents integration changed.

**Validation / evidence:** `NODE_ENV=test node --test lib/rpc-manager.test.mjs` passed 156/156. The repository-wide `NODE_ENV=test node --test lib/*.test.mjs components/*.test.mjs` passed 908/908 with a disposable empty `PI_CODING_AGENT_DIR`, isolating the suite from user-installed extensions. The first inherited-agent-directory broad attempt produced no test assertion failure but was terminated after 20 minutes because the user-installed Pi Subagents extension left one referenced supervisor-directory watcher in the `session-channel-integration` child; that file independently passed 18/18 under the same disposable agent-directory isolation. `node_modules/.bin/tsc --noEmit`, `npm run lint`, and `git diff --check` passed. A temporary worktree `node_modules` link to the retained main dependency tree and test-created `.next` development artifacts were removed; no `next build` was run.

**Departures from approved obligations:** None. The disposable agent-directory isolation removes external user-extension process lifetime from the broad repository check without changing the code or test command under validation.

**Implementation commit:** Pending.
