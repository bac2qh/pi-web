## Review

- **Correct:** The current compatibility-key approach is minimal. All production imports remain under `@earendil-works/*`; `next.config.ts:8-16` reads and externalizes that alias path, so the overlaid fork version should display without import churn.
- **Note — high:** Adoption is not yet present. `package.json:35-37` and `package-lock.json:12-14,1009-1058,1505-1554,2853-2864` still resolve registry `0.82.1`, including TypeBox `1.1.38`. The exact fork is checked out cleanly at `734502cb86eaf631e1ceeb403dbd717e3b78404f`.
- **Correct:** The wrapper-facing `0.84.0` APIs appear source-compatible:
  - Session factories remain exported at `/Users/xin/Documents/repos/pi/packages/coding-agent/src/index.ts:198-213`; Pi Web uses them at `lib/rpc-manager.ts:1930-1946`.
  - `AgentSession` still exposes synchronous `dispose()`, async `prompt()`/`abort()`, and subscription at sibling source `core/agent-session.ts:819-859,1120-1145,1551-1565`, matching `lib/pi-types.ts:116-161`.
  - Clone primitives remain compatible at sibling `core/session-manager.ts:1412-1455,1519-1549`; Pi Web uses them at `lib/session-clone.ts:72-110`.
  - Package/resource/settings methods used by `app/api/plugins/route.ts:201-232,293-322` and `lib/skills-service.ts:5-12` retain their signatures. The fork exports remain at `coding-agent/src/index.ts:187-197,252-260,403`.
  - TUI keybindings remain exported at `tui/src/index.ts:45-56`. Theme’s background type widened for optional `scrollbarThumb`, but Pi Web’s constructor cast and plain-text overrides avoid a required change.
- **Correct:** The delta-only change is a JSON/RPC wire change, not the in-process native session event. Sibling `coding-agent/src/modes/json-event.ts:5-39` strips the outer message and cumulative `partial`, while native `AgentEvent` still includes both at `packages/agent/src/types.ts:422-433`. Pi Web subscribes directly to `AgentSession` and its projector already ignores the outer message at `lib/session-projector.ts:571-577`; therefore no demonstrated projector change is required.
- **Correct:** The fork-specific lifecycle is exactly the risky ordering: tool results cause between-turn compaction at sibling `core/agent-session.ts:535-559`, threshold compaction emits `compaction_start`/`compaction_end` at `2140-2259`, and only final session settlement emits `agent_settled` at `600-607`. The fork regression confirms one native `agent_start`, one threshold compaction, and one `agent_end` across continuation at `agent-session-between-turn-compaction.test.ts:257-337`.
- **Note — medium:** Existing Pi Web lifecycle coverage is synthetic. `lib/rpc-manager.test.mjs:2025-2060,2227-2243,2651-2677` manually injects discriminants into fake inners. It proves wrapper accounting but does not prove the packaged fork emits the assumed trace.
- **Note — medium:** `0.84.0` introduces committed-but-unsynchronized credential failures. `CredentialSynchronizationError` explicitly means the credential mutation committed before local model/auth synchronization failed (`model-runtime.ts:89-108,510-529,669-683`). Pi Web invalidates its model cache only after successful awaits (`app/api/auth/login/[provider]/route.ts:119-164`, `auth/api-key/[provider]/route.ts:27-47,55-60`, `auth/logout/[provider]/route.ts:11-17`). On this new failure mode, users can receive an error despite a committed login/logout, while Pi Web’s 60-second model cache remains stale. Focused tests should characterize this before deciding whether invalidation belongs in `finally` or a specific `CredentialSynchronizationError` branch.
- **Correct:** TypeBox advances from `1.1.38` to `1.3.7` in the exact `0.84.0` manifests (`coding-agent/package.json:45-66`, `ai/package.json:62-75`), but Pi Web has no direct TypeBox import. The integration test should import `Type` from the installed `@earendil-works/pi-ai` export (`ai/src/index.ts:1-2`) rather than add another direct dependency.
- **Correct:** Hosted implementation ownership is Pi-Web-local (`lib/hosted-implementation-session.ts:31-57`); its only Pi-sensitive seam is the wrapped session, so no hosted protocol change is indicated.

### Smallest actual-trace integration seam

Add one isolated test, preferably `lib/local-pi-fork-integration.test.mjs`, rather than enlarging the already extensive synthetic RPC suite:

1. Import `createAgentSession`, `ModelRuntime`, `SessionManager`, and `SettingsManager` through the installed compatibility key; import `fauxProvider`, `fauxAssistantMessage`, `fauxToolCall`, and `Type` from installed `@earendil-works/pi-ai`.
2. Use only temporary cwd/agent paths and in-memory settings/session state. Register the faux provider with `ModelRuntime.registerNativeProvider()` and a synthetic runtime API key.
3. Seed compactable in-memory history, set a `2,000`-token faux model, enable compaction with zero reserve, and register one custom echo tool.
4. Script three faux responses: tool call, compaction summary, final continuation.
5. Wrap the resulting real packaged `AgentSession` in `AgentSessionWrapper`, call `wrapper.start()`, and prompt through `wrapper.send()`.
6. Retain only sanitized event discriminants, compaction reason/outcome, projected frame types, and running/idle transitions.
7. Assert:
   - exactly one native `agent_start`, threshold `compaction_start`/`compaction_end`, `agent_end`, and `agent_settled`;
   - continuation occurs after `compaction_end`;
   - no global idle callback occurs before the observed native `agent_settled`;
   - no `run_settled` or final snapshot exists at `compaction_end`;
   - exactly one projected `run_settled` and final snapshot occur;
   - projected finality precedes the sole global idle transition;
   - faux call count is three, proving real provider/tool/summary/continuation execution.

This uses the public construction seam confirmed at sibling `coding-agent/src/index.ts:198-213` and the faux-provider API at `ai/src/providers/faux.ts:40-145,675-707`, without adding production dependency injection.

### Exact focused commands

```bash
# Exact-fork source regression, from a disposable exact-commit source tree
npm --prefix packages/coding-agent exec -- vitest run test/suite/agent-session-between-turn-compaction.test.ts

# New packaged-fork/wrapper integration seam
NODE_ENV=test node --test lib/local-pi-fork-integration.test.mjs

# Existing Pi boundary suites
NODE_ENV=test node --test \
  lib/rpc-manager.test.mjs \
  lib/session-projector.test.mjs \
  lib/session-view-projection.test.mjs \
  lib/session-clone.test.mjs \
  lib/session-reader.test.mjs \
  lib/hosted-implementation-session.test.mjs \
  lib/session-channel-integration.test.mjs \
  lib/models-cache.test.mjs \
  lib/skill-lock.test.mjs \
  lib/skill-updates.test.mjs

node_modules/.bin/tsc --noEmit
npm run lint

npm ls --all \
  @earendil-works/pi-ai \
  @earendil-works/pi-coding-agent \
  @earendil-works/pi-tui \
  @earendil-works/pi-agent-core \
  @earendil-works/pi-client \
  @earendil-works/pi-protocol \
  @earendil-works/pi-telemetry
```

### Residual risks / unknowns

- The exact `0.84.0` artifact has not yet been built or installed, so no `0.84.0` compile or runtime result is attested here.
- Alias lock representation, shrinkwrap placement, integrity, fork metadata overlay, and byte reproducibility remain unverified.
- Auth partial-commit behavior is source-demonstrated but not reproduced through Pi Web routes.
- Plugin and skill public signatures remain compatible by source comparison, but there are no dedicated installed-`0.84.0` route tests yet.
- Current focused tests and TypeScript passed only against installed registry `0.82.1`.
- No files were edited or staged. Existing untracked checkpoint/subagent state was preserved.