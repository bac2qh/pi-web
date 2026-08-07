# Code Context

## Files Retrieved
1. `/Users/xin/Documents/repos/pi/scripts/local-release.mjs` at Git object `734502cb8:scripts/local-release.mjs` (lines 8-17, 87-100, 116-141, 187-237) - package order, external-output guard, build/check/test/pack sequence.
2. `/Users/xin/Documents/repos/pi/package.json` at `734502cb8:package.json` (lines 14-49, 63-65) - authoritative scripts and Node floor.
3. `/Users/xin/Documents/repos/pi/packages/coding-agent/package.json` at `734502cb8:packages/coding-agent/package.json` (lines 1-43, 45-77, 100-107) - published files, build/test scripts, runtime graph and identity.
4. `/Users/xin/Documents/repos/pi/packages/coding-agent/npm-shrinkwrap.json` at `734502cb8:packages/coding-agent/npm-shrinkwrap.json` (lines 1-43) - the two shrinkwrap root identity locations and companion ranges.
5. `/Users/xin/Documents/repos/pi/packages/ai/package.json` at `734502cb8:packages/ai/package.json` (lines 46-60, 62-75, 88-95) - generated model-data/build behavior and TypeBox/telemetry versions.
6. `/Users/xin/Documents/repos/pi/packages/coding-agent/src/core/agent-session.ts` diff `v0.84.0..734502cb8` (hunks at source lines 541-553, 1951-1980, 2088-2309) - fork behavior.
7. `/Users/xin/Documents/repos/pi/packages/coding-agent/test/suite/agent-session-between-turn-compaction.test.ts` at `734502cb8` (lines 1-786; especially 168-392 and 733-786) - faux-provider regression and event/order assertions.

## Key Code

### Recommended standard-library-only helper
Use only `node:fs`, `node:path`, `node:os`, `node:child_process`, `node:crypto`, `node:stream/promises`, and `node:zlib` if inspection requires it. Suggested seams:

- `verifyEnvironment()`: require exact `process.version === v24.19.0`; capture `npm --version` and require `11.17.0`.
- `verifyObject(fork)`: `git -C <fork> cat-file -e <full>^{commit}` then require `git rev-parse <full>^{commit}` equals the full hash. Do **not** require checkout HEAD/cleanliness; neither affects archived bytes.
- `materializeExactSource(temp)`: `git -C <fork> archive --format=tar <full>` piped to system `tar -xf - -C <temp>` (or use a temporary archive file). This reads the object, not the worktree. Keep all temp source/build/stage paths outside both repositories.
- `hydrateAndValidate(source)`: `npm ci --ignore-scripts`; then invoke the fork release path with `node scripts/local-release.mjs --out <external> --force --skip-install --skip-bun-install`. It itself runs model generation, `npm run check`, per-package clean/build, `./test.sh`, and packs all packages (`local-release.mjs:216-237`). For a fast explicit regression seam run `npm --prefix packages/coding-agent exec -- vitest --run test/suite/agent-session-between-turn-compaction.test.ts` before/alongside the full path.
- `stageCodingAgent()`: copy the built coding-agent package (including `dist`, declared docs/examples, shrinkwrap) into a fresh stage, apply only JSON metadata below, and prove a recursive digest/mode/symlink inventory differs only in the two JSON files and declared keys.
- `packStage()`: `npm pack --json --ignore-scripts --pack-destination <fresh-output>` from the stage. Parse JSON rather than predicting npm output.
- `inspectAndHash()`: `npm pack --dry-run --json --ignore-scripts` for file manifest; `npm exec --yes=false` is unnecessary. Hash tarball bytes with `createHash('sha256')` and `createHash('sha512')`; encode SHA-512 as `sha512-<base64>` for lock comparison.
- Run the whole source/build/stage/pack pipeline twice in fresh directories and compare raw tarball bytes (`timingSafeEqual` after equal lengths), not extracted trees. Publish with copy-to-unique-temp in the target directory followed by `renameSync`, refusing replacement unless existing bytes have the same hashes.

### Metadata-only overlay
`packages/coding-agent/package.json`:
- `name`: `@bac2qh/pi-coding-agent`
- `version`: `0.84.0-bac2qh.734502cb8`
- `repository`: `{ "type":"git", "url":"git+https://github.com/bac2qh/pi.git", "directory":"packages/coding-agent" }`
- `gitHead`: `734502cb86eaf631e1ceeb403dbd717e3b78404f` (conventional npm provenance field; preferable to inventing a runtime field).

`npm-shrinkwrap.json`:
- top-level `name`, `version`
- `packages[""]`.`name`, `version`

Do not alter dependencies, overrides, engines, bin, exports, files, or nested lock nodes. Package `files` includes only `dist`, docs/examples, two docs and shrinkwrap (`coding-agent/package.json:27-34`); `package.json` is automatically included by npm. Expected npm filename after overlay is `bac2qh-pi-coding-agent-0.84.0-bac2qh.734502cb8.tgz`; final path is `/Users/xin/Documents/repos/pi/.artifacts/pi-web/734502cb8/bac2qh-pi-coding-agent-0.84.0-bac2qh.734502cb8.tgz`.

### Fork behavior and installed-artifact trace
The hook wraps `prepareNextTurnWithContext`; only a completed nonempty `toolResults` batch triggers threshold estimation, compaction, and context replacement (`agent-session.ts` diff lines 541-553, 1951-1980). Parent-run abort is bridged into compaction and listeners are removed; `compaction_start` is emitted only after preparation, and every started path emits `compaction_end` (`2088-2309`). The faux regression proves one `agent_start`, tool batch, `compaction_start/end`, continued provider request, and one `agent_end` without a second run (`agent-session-between-turn-compaction.test.ts:168-260`); it also covers parallel result ordering and terminating tools.

Installed trace seam: import `AgentSession` and faux helpers through Pi Web's compatibility install path, recreate the regression harness using a tiny faux model, deterministic response queue, one deterministic tool, low context window, seeded synthetic history, and an inline `session_before_compact` result (avoids a second provider summarization call). Subscribe to native session events before `prompt()`, sanitize immediately to `{index,type,reason,aborted,willRetry}` only, and pass those actual events through the real `AgentSessionWrapper`/projector seam. Assert native order `agent_start < message/tool events < compaction_start < compaction_end < next assistant completion < agent_end`; wrapper/global running must remain true until the terminal native settlement derived after `agent_end`. Never retain message content, arguments, results, IDs, cwd, or provider payloads.

## Architecture
`local-release.mjs` is a release orchestrator, not a reusable library: it regenerates models, mutates the disposable archived tree via check/build, runs all tests, packs eight workspaces, and optionally installs/builds Bun (`lines 216-260`). Call it with both skip-install flags and consume only its coding-agent output as build validation; perform identity overlay and final pack in a separate stage so official source/build files remain auditable. Coding-agent's shrinkwrap pins the installed companion closure while its manifest declares `^0.84.0` (`package.json:45-50`; shrinkwrap `12-16`).

## Risks / findings
- **High — byte reproducibility:** `local-release` always runs `generate:models` (`216-218`); AI generation is strict and then offline build checks/copies generated data (`ai/package.json:50-60`). Network/catalog changes, locale/TZ, generated ordering, file modes, and npm tar implementation can change bytes. Exact Node/npm pin, fresh source, stable environment (`TZ=UTC`, `LC_ALL=C`), and two raw-byte builds are mandatory. If model generation needs network or changes tracked files differently, block rather than skipping it.
- **High — `npm run check` writes:** Biome uses `--write` (`root package.json:18`). Safe only in disposable archives; verify source-tree delta after build and distinguish expected generated/build output from unexpected source rewrites.
- **High — final relative path:** nested Pi Web worktree cannot resolve `file:../pi/...` like retained main. Lock generation/clean-install must occur in a disposable sibling-layout copy; do not “fix” the manifest for the worktree.
- **Medium — npm pack scripts:** final stage must use `--ignore-scripts`; otherwise package lifecycle behavior/tool-version changes can mutate output. The fork local release's own `npm pack` lacks this flag (`193-196`), so its tarball is validation input, not the final overlaid artifact.
- **Medium — archive extraction:** system `tar` is outside Node stdlib but avoids writing into sibling repo. Validate no absolute/`..` entries if implementing custom extraction; safest is trusted `git archive` piped directly to `tar` in a private temp directory.
- **Medium — `gitHead`:** an archive/stage has no `.git`; explicit `gitHead` is necessary if it is the chosen provenance field. Assert packed `package/package.json` retains it.
- **Medium — faux trace construction:** source test harness imports TypeScript internals and Vitest. An installed-artifact integration should not import the source harness; build a small JS harness solely from exported `dist` APIs. If construction is not public enough, capture the native sanitized trace in a fork test and replay it through Pi Web, but direct wrapper integration is stronger.
- **Low — extra release tarballs:** local-release packs eight packages (`8-17`, `233-237`). Keep them temporary; only atomically publish the overlaid coding-agent tarball.

## Exact command shapes
```sh
node --version                         # must be v24.19.0
npm --version                          # must be 11.17.0
git -C /Users/xin/Documents/repos/pi cat-file -e '734502cb86eaf631e1ceeb403dbd717e3b78404f^{commit}'
git -C /Users/xin/Documents/repos/pi archive --format=tar 734502cb86eaf631e1ceeb403dbd717e3b78404f | tar -xf - -C "$SOURCE"
(cd "$SOURCE" && npm ci --ignore-scripts)
(cd "$SOURCE" && npm --prefix packages/coding-agent exec -- vitest --run test/suite/agent-session-between-turn-compaction.test.ts)
(cd "$SOURCE" && node scripts/local-release.mjs --out "$RELEASE_OUT" --force --skip-install --skip-bun-install)
(cd "$STAGE" && npm pack --json --ignore-scripts --pack-destination "$PACK_OUT")
node scripts/build-local-pi-fork.mjs   # final documented wrapper; runs two builds and atomic publication
npm ci --ignore-scripts                # only after artifact exists in final sibling layout
npm ls --all @earendil-works/pi-coding-agent @bac2qh/pi-coding-agent @earendil-works/pi-ai @earendil-works/pi-tui
```

## Start Here
Open `scripts/build-local-pi-fork.mjs` first: keep orchestration and pure validation helpers separable/exportable so tests can inject temporary directories and a command runner, and so failure categories are unit-testable without performing the expensive build.