# Pi Web Dependency-Security Refresh

> **Closeout — completed manually on 2026-07-23.** Open Implementation initially failed preflight because this plan lacked its later-added `Implementation Handoff`; the user then explicitly chose a manual non-main worktree workflow. Implementation commit `caaa1bd9393b9c5a4abfcf383f1fa99c2249e85c` was fast-forwarded to local `main` without a merge commit. Verification covered clean npm installation, production/full audits with only the approved moderate Pi-shrinkwrapped protobufjs record, the exact known Emoji Mart peer warning, Node tests, TypeScript, lint, diff check, sharp native processing, production build, and user-confirmed local/hybrid runtime load. The manual worktree and branch were removed. No matching checkpoint was created; detailed Width/Transcript/UI browser-matrix evidence and Pi Web README updates were waived by the user-directed manual closeout, while dotfiles current-state documentation and the local runtime cutover were committed separately as `67512164396c6c2e0d642ae6f98751950e033353`. `bun.lock` remains unchanged/unvalidated, package version remains `0.7.16`, and no push/release occurred. Pi Web has no main-lock helper; closeout used the user-owned single-worktree state with no competing Pi Web worktree and records that exception here.

Status: approved
Date: 2026-07-23
Approval: explicitly approved by the user on 2026-07-23, including all five Approval Decision items

## Objective

Refresh Pi Web’s project-local npm dependency graph so that:

- `npm audit --omit=dev` and full `npm audit` report no findings except the one explicitly accepted, upstream-shrinkwrapped `protobufjs@7.6.4` moderate advisory described below;
- every other current production and development finding is removed with compatible updates;
- the application’s behavior is unchanged;
- dependency and build work occurs only in the non-main worktree created by **Open Implementation**;
- no global Pi Web package, Pi-managed package, user-global Pi CLI, or other global npm tool is modified; and
- the resulting checkout can be built and launched directly through its existing executable Node launcher without a global installation.

The package remains `@agegr/pi-web@0.7.16`; this is a security refresh, not a release or version-bump task. The accepted Pi exception does not authorize a private Pi build, fork, repack, shrinkwrap bypass, or concealed lock/audit result.

## Planning Baseline

### Source state

- Main checkout: `/Users/xin/Documents/repos/pi-web`
- Branch: `main`
- Commit: `e72ddc15da84042f63f28d75ea4c3d040d8ea20b`
- Tree: `58200abff2951309f3e4d17b645f3d7dad048cbe`
- Tracked diff at first inspection: empty
- `node_modules/`: absent
- `.next/`: absent
- Package identity/version: `@agegr/pi-web@0.7.16`
- `.agents/memory/MEMORY.md`: absent; no project memory index currently exists

The supplied baseline said 23 unrelated untracked entries. The first repository read on 2026-07-23 observed 27 unrelated untracked files instead. They consist of five existing plan files and prior `.pi-subagents` artifacts. This plan treats all 27 observed files, plus any later independently created files, as unrelated state that must not be deleted, rewritten, staged, or committed. The subagent artifacts created solely for this planning investigation were removed by exact run ID after their results were collected.

Because Open Implementation creates a linked non-main worktree from tracked `main`, these source-main untracked files should not be copied into the implementation checkout. Immediately before opening, capture a privacy-safe inventory of every unrelated untracked path plus its SHA-256 digest, excluding only this selected plan; repeat it after validation and closeout. Any path/content drift must be attributed or reported, never overwritten or cleaned merely to match an earlier count.

### Deployment-state confirmation

A bounded read-only check on 2026-07-23 found:

- `/opt/homebrew/lib/node_modules/@agegr/pi-web` absent and not a symlink;
- `~/.pi/agent/npm` present with `@agegr/pi-web@0.7.16`;
- the user-global `pi` executable at `/Users/xin/.local/bin/pi` reporting `0.81.1` from `pi --version`.

The user subsequently confirmed that they intentionally removed the Homebrew global Pi Web candidate. This resolves the earlier apparent drift; this source task must preserve that absence and leave both the Pi-managed Pi Web package and user-global Pi CLI untouched. The CLI already being `0.81.1` is independent of this repository, whose three direct Pi dependency declarations remain `^0.80.10` until implementation. At each boundary, baseline each named Pi Web location as present or absent, fingerprint only defined safe package/lock artifacts when present, record the Pi CLI path/version, and report any new external drift without trying to repair it.

The requested replacement workflow is checkout-local: install and build in the complete fork checkout, then run its tracked executable `./bin/pi-web.js` (mode `100755`) or `node ./bin/pi-web.js`. This is a Node launcher backed by that checkout’s local `node_modules` and `.next`, not a self-contained native binary.

### Current audits

Read-only npm audit queries against the locked tree, using npm `11.16.0` and Node `v24.18.0`, produced:

- Production audit: 7 findings — 4 high, 3 moderate, 0 critical.
- Full audit: 9 findings — 5 high, 3 moderate, 1 low, 0 critical.
- The two additional full-tree findings are dev-only `@babel/core` and `js-yaml` paths.

Current affected paths and known compatible floors:

| Surface | Locked state | Required floor from current advisory data | Constraint |
|---|---:|---:|---|
| Next | `16.2.9` | `16.2.11` | Direct exact dependency; pair with `eslint-config-next`. |
| Mermaid | `11.14.0` | `11.15.0` | Direct compatible 11.x update. |
| DOMPurify | `3.4.2` | `3.4.12` | Mermaid transitive; current range accepts it. |
| brace-expansion 5.x | `5.0.4` and nested `5.0.6` | `5.0.7` | Existing minimatch 10.x ranges accept it. |
| brace-expansion 1.x | four `1.1.12` copies | `1.1.16` | Existing minimatch 3.x ranges accept it. |
| PostCSS | root `8.5.8`; Next-pinned `8.4.31` | `8.5.12` for all current advisories | Root range accepts it; Next 16.2.11 does not. |
| protobufjs | `7.6.1` and Pi-shrinkwrapped `7.6.4` | `7.6.5` | Update compatible non-Pi copies; explicitly accept only the Pi-shrinkwrapped `7.6.4` remainder. |
| sharp | `0.34.5` | `0.35.0` | Next 16.2.11 declares `^0.34.5`, which excludes the fixed line. |
| `@babel/core` | `7.29.0` | `7.29.6` or newer compatible 7.x | Dev-only current finding. |
| `js-yaml` | `4.1.1` | `4.3.0` | Dev-only current finding. |

Registry metadata and temporary simulations outside the repository established five important facts:

1. `next@16.2.11` is the smallest stable 16.2.x release fixing the direct July 2026 Next advisories, but its published manifest still pins `postcss@8.4.31` and allows only `sharp@^0.34.5`. A Next bump alone therefore does **not** yield a clean audit.
2. `@earendil-works/pi-coding-agent@0.80.10` publishes `npm-shrinkwrap.json` and is marked `hasShrinkwrap`; that nested lock pins `brace-expansion@5.0.6` and `protobufjs@7.6.4`. `0.80.10` is the only published version satisfying the current `^0.80.10` direct range.
3. A live 2026-07-23 registry recheck confirmed `0.81.1` remains latest for Pi AI, coding-agent, agent-core, and TUI. The separately installed user-global Pi CLI also reports `0.81.1`, but the source manifest is not yet on that line: its three project-local direct Pi dependencies still declare `^0.80.10`.
4. `@earendil-works/pi-coding-agent@0.81.1` improves the shrinkwrapped brace-expansion copy to `5.0.7` but still pins production `protobufjs@7.6.4`. An isolated audit of that package reported exactly one moderate finding: advisory source `1123964`, `GHSA-j3f2-48v5-ccww`, at `node_modules/@earendil-works/pi-coding-agent/node_modules/protobufjs`. Root npm overrides, targeted `npm update`, and ordinary `npm audit fix` do not penetrate the published shrinkwrap.
5. Deleting the nested root-lock record can make audit output omit the finding, but `npm ci --include=dev` still installs the vulnerable shrinkwrapped copy. That is audit hiding and remains prohibited.

The user explicitly accepts that one upstream remainder and does not want a private/forked Pi package. The implementation therefore updates the project-local Pi AI/coding-agent/TUI floors together from `^0.80.10` to `^0.81.1`, removes the older shrinkwrapped brace-expansion finding, and records—but does not suppress—the exact remaining protobufjs advisory. Any different Pi vulnerability, version, path, severity, or additional audit finding is outside this exception.

### React peer compatibility

The invalid peer chain is:

```text
@lobehub/icons -> peer @lobehub/ui -> @emoji-mart/react@1.1.1 -> peer react ^16.8 || ^17 || ^18
Pi Web -> react@19.2.4
```

- `@emoji-mart/react@1.1.1` remains the latest published wrapper and does not advertise React 19.
- Current `@lobehub/icons` and `@lobehub/ui` releases retain the same parent path; updating either does not remove the warning.
- The framework-neutral `emoji-mart` package does not fix the React wrapper’s peer declaration.
- Pi Web imports deep icon component paths from `@lobehub/icons`; migrating away from that package or from the wrapper path would be an application/dependency architecture change, not a compatible lock refresh.

Therefore this plan does not hide the warning with `legacy-peer-deps`, a broad override, or fabricated peer metadata. The approval decision below defines the only bounded exception this task may accept.

## Scope

### In scope

- Update `package.json` and `package-lock.json` in the Open Implementation worktree.
- Keep Next and `eslint-config-next` aligned on the smallest suitable stable patch.
- Update Mermaid within 11.x and refresh its DOMPurify path.
- Refresh vulnerable transitive production and dev dependencies within existing compatible ranges.
- Update the three direct `@earendil-works/pi-*` packages together from `^0.80.10` to `^0.81.1`, the latest stable line at the evidence cutoff, and preserve an honest audit record of its exact accepted protobufjs remainder.
- Use a narrowly scoped npm override only where stable Next metadata cannot select patched PostCSS/sharp versions.
- Inspect and minimize lockfile churn; explain every changed package family.
- Document local production build/start commands in `README.md` and `README.zh-CN.md`.
- Run static, audit, build, native-module, and privacy-safe browser/runtime validation.
- Record durable override/compatibility decisions in the checkpoint and project memory.
- Produce a concise local-run handoff containing the final commit/tree, exact checkout build/start commands, evidence, and confirmation that paused dotfiles state was untouched.

### Out of scope

- Any dependency edit directly on local `main`.
- `npm audit fix --force`, preview/canary Next releases, broad dependency refreshes, or semver-major/out-of-range upgrades other than the explicitly approved sharp `0.34 -> 0.35` and Pi suite `0.80 -> 0.81` exceptions.
- Any manual `package-lock.json` edit, deletion of nested shrinkwrap-derived records, or audit-output suppression.
- Hiding the Emoji Mart warning with `legacy-peer-deps`, `--force`, broad overrides, or altered third-party peer metadata.
- Replacing `@lobehub/icons`, migrating Emoji Mart APIs, or changing visible icons/UI behavior.
- Recreating, updating, or otherwise changing `/opt/homebrew/lib/node_modules/@agegr/pi-web`, which the user intentionally removed.
- Creating, updating, or deleting the Pi-managed package under `~/.pi/agent/npm`, currently observed as `@agegr/pi-web@0.7.16`.
- Building, forking, repacking, or publishing a private Pi runtime, or producing a self-contained native Pi Web binary; the supported artifact is the existing checkout-local executable Node launcher plus local build output.
- Installing, uninstalling, or updating global/user-global npm packages or tools, including the existing `/Users/xin/.local/bin/pi` CLI.
- Publishing, tagging, pushing, running `npm run release`, or changing package version `0.7.16`.
- Editing the paused dotfiles checkout or changing its `b6bd37c` deployment state.
- Treating an arbitrary detached directory as a Next output directory; an explicit build root must be a complete Pi Web project root.
- Updating `bun.lock`. npm is the documented install/release path and the explicit target of this task; Bun lock parity/security remains unclaimed. If Bun support is required, stop and plan it separately rather than silently widening this refresh.

## Touched-Surface Classification

- `configuration`: `package.json` direct versions and a narrowly scoped npm override.
- `dependency lock/runtime`: `package-lock.json`, native sharp artifacts, Next/PostCSS, Mermaid/DOMPurify, Pi SDK transitives, and dev-tool transitives.
- `ui/frontend`: no source behavior change, but Mermaid and all display controls require public-surface regression proof.
- `docs/current-state`: supported local production build/start commands in both READMEs.
- `cross-platform`: lockfile optional sharp packages and local-build command portability; runtime proof is required on the deployment host, while lock diff scrutiny covers other optional platform records.
- `telemetry/debuggability`: no production telemetry change; validation diagnostics are defined below.
- `execution state`: plan, checkpoint, memory, validation artifacts, and local-run handoff.
- `global deployment state`: read-only preservation boundary only.

## Decision Ledger

| ID | Decision | Rationale / authority | Consequence |
|---|---|---|---|
| D-001 | Use Open Implementation to create the non-main dependency worktree; never install/build/edit dependencies on source `main`. | Explicit workflow correction and repository rules. | Worktree-local `node_modules` and `.next`; main remains planning-only. |
| D-002 | Recheck current stable metadata and audits before editing. Prefer the smallest stable 16.2.x release whose manifest natively selects patched PostCSS and sharp; otherwise use exact Next/ESLint `16.2.11`. | Advisory and registry data are time-sensitive. | A newly published compatible stable patch can remove the override without reopening scope; preview/canary or major/minor Next expansion still requires a new decision. |
| D-003 | Set Mermaid’s manifest floor to `^11.15.0` and lock the smallest 11.x release that clears all live Mermaid advisories, initially `11.15.0`; resolve DOMPurify to at least `3.4.12`. | `11.15.0` is the first release outside all current Mermaid affected ranges. | Avoids an unnecessary major update; browser Mermaid regression proof is mandatory. |
| D-004 | Update project-local Pi AI/coding-agent/TUI floors together to `^0.81.1` without modifying or repacking Pi’s published shrinkwrap. Accept only its production `protobufjs@7.6.4` moderate advisory at the exact nested path/source recorded above. | `0.81.1` is the latest stable suite and fixes the older shrinkwrapped brace-expansion issue, but no published Pi release fixes protobufjs. The user explicitly rejects a private/forked Pi build and accepts this one remainder. | Audits remain intentionally nonzero and must expose exactly that one record. A different Pi release/finding or any concealment requires review; no manual lock surgery is permitted. |
| D-005 | If stable Next still cannot select fixed transitives, retain exactly `"next@16.2.11": { "postcss": "8.5.12", "sharp": "0.35.0" }`. | Removing all non-Pi production findings is otherwise impossible on stable Next 16.2.11. | These exact out-of-range values are the sole Next exception. Changed advisory floors require a plan amendment; build, native sharp, production-start, and browser gates block acceptance on failure. |
| D-006 | Remove every audit finding except D-004’s exact accepted protobufjs record from both production and full audit. | All other current production and dev findings have compatible fixes; silently reporting “clean” would hide the installed Pi copy. | The expected audit result is exactly one moderate vulnerability and a nonzero exit. Any additional/different record blocks; never force-fix or suppress the accepted path. |
| D-007 | Do not update `@lobehub/icons`/`@lobehub/ui` merely to chase the Emoji Mart warning, because current releases preserve the same invalid peer. | Registry evidence shows no compatible package-only fix. | `npm ls --all` must be otherwise clean. The exact known Emoji Mart chain may be accepted only through the explicit bounded approval below. |
| D-008 | Preserve npm as this task’s authoritative package-manager surface and leave `bun.lock` unchanged. | README, release docs, requested commands, and validation contract are npm-specific. | Do not claim a refreshed Bun tree; Bun parity is a separate scope decision. |
| D-009 | Document both checkout-root and explicit-root forms using `npm --prefix` and the tracked executable repository launcher. | These resolve project-local dependencies and `.next` without global installation. | Docs must state that the root is a complete checkout, `./bin/pi-web.js` is an executable Node launcher rather than a self-contained binary, build output stays at `<root>/.next`, and `npm run release` is not a validation command. |
| D-010 | Build/runtime evidence uses a private temporary Pi agent directory and synthetic/redacted fixture content. | Browser proof is required, but private sessions and content must not enter artifacts. | Screenshots/logs may contain only safe fixture UI, bounded geometry, stages, and error categories. |

## Approval Decision

Approving this plan explicitly approves all five bounded decisions below:

1. **Next transitive override:** use exactly the parent/version-scoped `postcss@8.5.12` and `sharp@0.35.0` override in D-005 only while no stable 16.2.x release has corrected dependency metadata. Different override values, broad overrides, or any other out-of-range package require a plan amendment.
2. **Published Pi exception:** update the three project-local Pi suite floors together to `^0.81.1` and accept exactly one remaining production/full-audit record: moderate `protobufjs@7.6.4`, advisory source `1123964` / `GHSA-j3f2-48v5-ccww`, only at `node_modules/@earendil-works/pi-coding-agent/node_modules/protobufjs`. This does not authorize root-lock surgery, audit suppression, a private Pi fork/repack, or any different/additional finding.
3. **Emoji Mart peer result:** after a clean `npm ci --include=dev`, `npm ls --all` may remain nonzero only if its complete problem set reduces to the already-known `@emoji-mart/react@1.1.1` React-19 peer mismatch through `@lobehub/ui`. The implementation must show the canonical chain and confirm there are no missing, extraneous, or additional invalid packages. Any different peer problem blocks and returns for review.
4. **npm-only lock scope:** `package.json`/`package-lock.json` are authoritative for this task and `bun.lock` remains unchanged and explicitly unvalidated.
5. **Local execution boundary:** preserve the user-removed Homebrew candidate as absent and leave both the Pi-managed `@agegr/pi-web@0.7.16` package and user-global Pi CLI `0.81.1` untouched. Build this fork locally and run its existing executable Node launcher from the complete checkout; do not create a standalone binary, install globally, cut over dotfiles, or change paused commit `b6bd37c`.

If any decision is unacceptable, do not approve this plan. The Pi exception and intentional global-candidate removal are now resolved policy decisions rather than pre-open blockers.

## Design / Implementation Strategy

### Phase 0 — Pre-open freshness guard on planning main

1. A 2026-07-23 read-only registry/tarball recheck confirmed `0.81.1` is still the latest stable Pi suite and has the exact shrinkwrapped versions and advisory disposition in D-004.
2. If Open Implementation is requested on a later date, repeat that bounded check before opening. If the latest stable Pi version or accepted audit record differs, stop for a plan amendment rather than silently changing the exception.
3. Confirm the intentional Homebrew candidate absence and Pi-managed package presence with present/absent-aware safe snapshots, and record only the user-global Pi CLI path/version; do not otherwise invoke or mutate global state.
4. Once `Status: approved` and the freshness guard still matches, wait for the user’s exact Open Implementation instruction; do not create a worktree manually.

### Phase 1 — Open and prove isolation

1. Use the exact Open Implementation trigger for this approved plan. Let the extension create the non-main linked worktree; do not create it manually.
2. In the implementation session, verify the session cwd is the linked worktree, the branch is non-main, and the source-main path differs.
3. Read this plan and the matching checkpoint completely; update the checkpoint before source edits.
4. Reconfirm source `main` commit/tree and capture the mandatory unrelated-untracked path/SHA-256 inventory, excluding only this selected plan, without modifying any inventoried file.
5. Before any implementation command, capture mandatory bounded snapshots for both named Pi Web deployment locations: present/absent state and path identity; when present, safe package-manifest version/checksum, selected lockfile checksums, and non-content stat metadata. Also record the user-global Pi CLI path and `--version` only. Never inspect global configuration, otherwise invoke global binaries, mutate global trees, or print secrets. Repeat the same snapshots after validation and after closeout for VC-001 evidence.

### Phase 2 — Recheck live dependency facts

1. Run timestamped production and full audits against the transferred lock before edits.
2. Query stable registry metadata for Next 16.2.x, matching `eslint-config-next`, Mermaid 11.x, PostCSS, sharp, DOMPurify, brace-expansion, protobufjs, `@babel/core`, `js-yaml`, the Emoji Mart parent chain, and Pi suite `0.81.1`.
3. Inspect the published Pi coding-agent `0.81.1` tarball and confirm its shrinkwrap still contains brace-expansion `5.0.7` plus protobufjs `7.6.4`; confirm audit source/path/severity still match D-004. Root overrides or root-lock omissions are not evidence.
4. Apply D-002 deterministically:
   - use the smallest stable 16.2.x package with corrected PostCSS/sharp ranges if one now exists;
   - otherwise use exact `next@16.2.11` and `eslint-config-next@16.2.11` plus the exact D-005 values;
   - stop rather than adopt preview/canary or a major/minor Next upgrade.
5. If the latest Pi release, accepted Pi audit record, advisory floors, or exact D-005 values have changed from the approved boundaries, record the blocker and return for a plan amendment before editing further.

### Phase 3 — Make targeted manifest and lock changes

1. Update direct manifest intent within the approved boundaries:
   - exact Next and matching exact `eslint-config-next` patch;
   - Mermaid floor `^11.15.0` (or the smallest newer 11.x floor required by live advisories);
   - matching `@earendil-works/pi-ai`, `@earendil-works/pi-coding-agent`, and `@earendil-works/pi-tui` floors at exactly `^0.81.1`;
   - the exact D-005 parent/version-scoped override only if still required.
2. Regenerate the lock exclusively through npm-generated, targeted, scripts-disabled lock-only operations. Do not manually edit `package-lock.json`, delete nested records, use `npm audit fix --force`, or suppress audit paths.
3. Refresh affected compatible subtrees outside the published Pi shrinkwrap: DOMPurify, brace-expansion 1.x, non-Pi protobufjs, root PostCSS, `@babel/core` 7.x, and `js-yaml` 4.x. The Pi package’s own shrinkwrap must supply brace-expansion `5.0.7` and the explicitly accepted protobufjs `7.6.4` copy.
4. Produce a before/after semantic package delta immediately after each targeted npm operation. The exact D-004 protobufjs record is expected; any other vulnerable record, unrelated broad reselection, or ecosystem-wide churn requires reverting only this task’s worktree changes and stopping for review.
5. Inspect `package.json` and package-lock semantic deltas:
   - direct versions and exact override match the decision ledger;
   - no new direct dependency was added merely to force a transitive package;
   - sharp `0.34 -> 0.35` and the matched Pi suite `0.80 -> 0.81` are the only approved out-of-range/pre-1.0 transitions;
   - optional sharp platform records and helpers from the selected Pi suite are expected and explained;
   - unrelated packages remain locked unless npm must update a same-family helper to satisfy the selected package;
   - `@lobehub/icons`, `@lobehub/ui`, React, and `@emoji-mart/react` remain unchanged unless an actually compatible upstream fix appeared and is separately reviewed.
6. Leave package version `0.7.16` and `bun.lock` unchanged.

### Phase 4 — Clean install and dependency gates

1. Remove only worktree-local install/build outputs as needed, then run `npm ci --include=dev` in the implementation worktree. This explicit flag prevents ambient `NODE_ENV=production` from omitting TypeScript, ESLint, Tailwind/PostCSS, or other build/test tooling.
2. Prove resolved versions with `npm explain`/`npm ls` for each affected package and inspect the final installed and lock paths.
3. Run `npm audit --omit=dev --json`. Its expected nonzero result is exactly one moderate vulnerability object for `protobufjs@7.6.4`, advisory source `1123964` / `GHSA-j3f2-48v5-ccww`, with only `node_modules/@earendil-works/pi-coding-agent/node_modules/protobufjs` in `nodes`; every other severity count is zero.
4. Run full `npm audit --json`. It must reduce to the same single accepted production record, proving current dev-only Babel/js-yaml findings were removed. Any extra/different record blocks rather than being ignored or force-fixed.
5. Independently enumerate installed protobufjs and brace-expansion paths so the accepted copy remains visible and no lock/audit omission can masquerade as remediation.
6. Run `npm ls --all` and apply the Approval Decision literally. No peer/missing/extraneous issue other than the exact reviewed Emoji Mart chain is acceptable.
7. Run a bounded sharp native smoke that creates and processes only a generated one-pixel image in memory; record version, success/failure, and platform class without logging bytes.

### Phase 5 — Static and production validation

Run from the dependency-populated worktree:

```bash
node --test components/*.test.mjs lib/*.test.mjs
node_modules/.bin/tsc --noEmit
npm run lint
git diff --check
npm run build
```

`npm run build` is intentionally required here. The repository’s normal-development prohibition protects an active dev checkout; this is an isolated release/security-validation worktree with its own `.next` and no concurrent dev server sharing that root.

Any failure blocks acceptance. Do not alter source behavior merely to silence a dependency regression without first recording and reviewing the required scope expansion.

### Phase 6 — Local production and browser proof

1. Create a temporary, non-repository Pi agent directory containing only synthetic/redacted session data needed for deterministic UI checks.
2. Start the just-built worktree through its local launcher on loopback and a non-conflicting validation port, for example:

```bash
PI_CODING_AGENT_DIR="$SAFE_FIXTURE_DIR" \
PI_WEB_NO_OPEN=1 \
node "$PI_WEB_ROOT/bin/pi-web.js" --hostname 127.0.0.1 --port 30142
```

3. Use a validator-provided browser driver or manual browser/DevTools validation; do not add Playwright/Cypress as a project dependency solely for this task.
4. Capture privacy-safe evidence that:
   - the production server starts and the app loads without browser console/page errors;
   - Width defaults, step/reset behavior, wide geometry, narrow full-safe-width behavior, and persistence still work;
   - Transcript changes ordinary text, composer, code, and a safe Mermaid diagram; the diagram re-renders naturally and remains horizontally accessible;
   - UI/Menu scaling changes representative chrome while leaving opened file content sizing unchanged;
   - wide inline controls and narrow/mobile Display popover remain keyboard/pointer accessible and do not overflow;
   - the safe Mermaid fixture renders under the updated Mermaid/DOMPurify tree.
5. Stop the local validation server and remove only temporary fixture/runtime artifacts created by this task.

### Phase 7 — Documentation and durable local handoff

1. Update `README.md` and `README.zh-CN.md` with equivalent local production instructions covering:
   - from a checkout: `npm ci --include=dev`, `npm run build`, then `./bin/pi-web.js --no-open` (or `node bin/pi-web.js --no-open`) or local `npm run start`;
   - from any cwd with an explicit complete build root: `npm --prefix "$PI_WEB_ROOT" ci --include=dev`, `npm --prefix "$PI_WEB_ROOT" run build`, and `"$PI_WEB_ROOT/bin/pi-web.js" --no-open ...` (or the equivalent `node` form);
   - the tracked mode-`100755` launcher uses that checkout’s local Node dependencies and `.next`; it is not a copied/self-contained native binary;
   - `.next` is generated inside that selected root;
   - do not share the root with a dev server, use bare `npx` as deployment resolution, run `npm run release`, or install globally for this workflow.
2. Add/update project memory for the durable Next override, accepted Pi protobufjs exception, Emoji peer decision, and checkout-local launcher workflow, including why each exists and its removal condition. Create the memory index/log according to global convention if they are still absent.
3. Complete the checkpoint with commands, exit codes, audit counts, package versions, lock-diff explanation, browser evidence, exception disposition, and residual risks.
4. Commit coherent implementation and documentation state on the task branch. Record the resulting commit and tree.
5. Prepare a concise local-run handoff report with:
   - Pi Web commit/tree and package version;
   - exact local root/build/start commands;
   - production/full audit totals and the exact accepted protobufjs record;
   - `npm ls` disposition;
   - static/build/browser/sharp evidence;
   - confirmation that neither named Pi Web deployment location nor the user-global Pi CLI was mutated by this task, including absent/present/path/version baselines and any externally attributed drift;
   - remaining override/peer/security-exception risks and the fact that any later global cutover or Pi-managed uninstall requires a separate approved dotfiles plan.
6. Close out through the repository workflow. Do not push or deploy unless separately requested. If local-main merge/cleanup could race and the standard main-branch lock helper is still absent, record the exception or establish the required guarded closeout mechanism before writing main. After merge/cleanup, repeat source-main commit/tree, the unrelated-untracked path/SHA-256 inventory, both present/absent-aware Pi Web deployment snapshots, and the Pi CLI path/version snapshot; unexplained drift blocks the handoff.

## Test Strategy

### Isolated coverage

- Run all existing Node tests with the repository’s explicit glob.
- Existing display-preference and Mermaid helper tests are the focused behavior layer.
- No new product unit test is required solely for package version numbers; lock/audit assertions and runtime behavior are stronger evidence for this change.
- A generated one-pixel sharp operation validates native loading without user data.

### Public-surface coverage

- Production build and production start from the implementation root.
- Browser exercise of Width, Transcript, UI/Menu, responsive control placement, persistence, safe Mermaid rendering, and overflow/error state.
- Local launcher exercise proves that the built checkout is runnable without a global installation.

### Dependency and static coverage

- `npm ci --include=dev`
- `npm audit --omit=dev --json` with exact-exception comparison
- full `npm audit --json` with exact-exception comparison
- `npm ls --all`
- focused `npm explain`/version inspection
- Node tests
- TypeScript
- ESLint
- `git diff --check`
- production build
- package-lock semantic diff review

### Waivers / blockers

- A checked-in browser test harness is **not applicable** to this dependency-only task; use an external/transient driver or manual browser proof.
- The exact Pi-shrinkwrapped protobufjs record in D-004 is **explicitly accepted** because no fixed published Pi exists and the user rejects a private Pi fork/repack. It must remain visible in both audit and installed-path evidence.
- Every other production or dev audit finding is **blocked pending explicit review**; the accepted protobufjs exception must not expand by package, version, path, advisory, or severity.
- Any npm-tree problem outside the exact reviewed Emoji chain is **blocked pending explicit review**.
- Cross-platform execution of every sharp optional binary is **not applicable** on one host; inspect all lock records and execute the deployment-host binary. Cross-platform release qualification would require separate runners.

## Telemetry / Debuggability

Production telemetry changes are **not applicable** because no application behavior or asynchronous workflow is being added.

Validation diagnostics must remain bounded and privacy-safe:

- timestamp, npm/Node version, command exit status, and audit severity counts;
- package names, resolved versions, dependency paths, override ownership, and lock-diff categories;
- build/start stage and sanitized error category;
- sharp version/platform class and generated-operation outcome;
- browser scenario name, control values, bounded CSS properties/geometry, overflow booleans, Mermaid stage/error name, and sanitized console/page-error category.

Do not capture or log secrets, environment values, API keys, session IDs, paths from private sessions, message text, Mermaid source/SVG, file contents, image/media bytes, full provider payloads, full localStorage dumps, or global package configuration.

## Validation Contract

| ID | Priority | Type / surface | Required truth | Required evidence | Validator mode | Blocker / waiver path |
|---|---|---|---|---|---|---|
| VC-001 | P0 | Source isolation / global state | All dependency installs, lock edits, and builds occur in the verified non-main Open Implementation worktree; source-main unrelated files, both named Pi Web deployment locations, and the user-global Pi CLI are not mutated by this task. | Cwd/branch/worktree proof; before/after/after-closeout main commit/tree plus unrelated path/SHA-256 inventory; task diff; deployment-location presence/path and safe artifact snapshots; Pi CLI path/version snapshots. | scrutiny | No waiver. Any task-owned main/global mutation or unexplained snapshot drift blocks and requires ownership/recovery review. |
| VC-002 | P0 | Production security | `npm audit --omit=dev --json` exposes exactly one moderate finding: Pi-shrinkwrapped `protobufjs@7.6.4`, source `1123964` / `GHSA-j3f2-48v5-ccww`, at the one approved nested node; all other severity counts are zero. | Timestamped command/nonzero exit, normalized vulnerability object/counts, installed-path version evidence, and saved/summarized audit evidence. | scrutiny | Only this exact user-approved record is waived. Any additional/different package, version, node, advisory, or severity blocks. |
| VC-003 | P0 | Dependency intent / compatibility | Next and ESLint are aligned on the selected stable patch; Mermaid/DOMPurify and compatible transitives meet live fixed floors; all three direct Pi floors are `^0.81.1`, its brace-expansion copy is fixed, and only D-004’s exact protobufjs copy remains; no other semver-major/out-of-range upgrade or broad override is present. | Manifest/lock diff, registry and tarball shrinkwrap evidence, resolved-version table, installed-tree paths, and `npm explain` output. | scrutiny | Any Pi version/finding outside D-004, private fork/repack, `0.82+`, or broader version/override requires a plan amendment. |
| VC-004 | P0 | Next override / native runtime | If D-005 is required, only parent `next@16.2.11` with exact child values `postcss@8.5.12` and `sharp@0.35.0` remains; Webpack build, sharp native smoke, production start, and browser load all pass. | `package.json` scrutiny, resolved tree, generated-image sharp result, build/start logs, browser evidence. | scrutiny + user-testing | Changed floors/values or any compatibility failure require a plan amendment; remove the override and wait for/review upstream rather than masking it. |
| VC-005 | P0 | Installed-tree integrity | `npm ci --include=dev` succeeds from the final lock; all brace-expansion copies and non-Pi protobufjs copies meet fixed floors; D-004’s one Pi protobufjs `7.6.4` copy is visibly installed. `npm ls --all` is clean except the exact approved Emoji Mart React-19 peer chain and nothing else. | Clean-install log; installed-path version enumeration independent of audit output; canonical npm-ls problem set; proof of no hidden, missing, extraneous, or additional invalid packages. | scrutiny | Only the exact Pi vulnerability and Emoji peer exceptions are reviewable; hidden or additional problems block. |
| VC-006 | P1 | Full-tree security | Full `npm audit --json` reports the same one accepted Pi protobufjs moderate record and no dev-only or other findings. | Nonzero exit, normalized vulnerability object/counts, and proof current Babel/js-yaml findings are absent. | scrutiny | Any additional/different finding is blocked for explicit review; never force-fix or suppress. |
| VC-007 | P0 | Static/build regression | Node tests, TypeScript, lint, diff check, and `npm run build` all pass on the final tree. | Commands and exit codes; test count; production build completion. | scrutiny | No waiver. |
| VC-008 | P0 | UI/frontend runtime | In a local production server, Width, Transcript, and UI/Menu controls retain defaults, bounds, persistence, responsive placement, accessible operation, and intended visual effects; Mermaid safely re-renders without stretching/overflow regression. | Privacy-safe browser scenarios, computed values/geometry, screenshots on synthetic content, and sanitized console/page-error evidence. | scrutiny + user-testing | If automation is unavailable, manual browser evidence is required; static review alone is insufficient. |
| VC-009 | P1 | Docs/current-state | English and Chinese docs accurately show checkout-root and explicit-complete-root local build/start commands, local `.next` behavior, and no-global-install boundaries. | Doc diff plus execution of the documented command shape against the worktree/root. | scrutiny | No waiver; incorrect deployment commands block handoff. |
| VC-010 | P1 | Lock scope / cross-platform | Lock changes are npm-generated and limited to selected package families, the matched Pi suite and required helpers/optional binaries; React/Lobe/Emoji and `bun.lock` remain unchanged under this scope. | Per-operation semantic version-delta report, final source diff, and proof of no manual lock editing. | scrutiny | Unexpected churn must be reverted or explicitly reviewed before acceptance. |
| VC-011 | P1 | Local-run handoff | The handoff reports final commit/tree, complete-checkout build/start commands, and evidence without changing `b6bd37c`, cutting over, changing either named Pi Web deployment location, or changing the user-global Pi CLI. | Tracked report/final response, command proof, and git/global-state evidence. | scrutiny | No global deployment or Pi CLI action is authorized by this plan. |
| VC-012 | P1 | Execution state | The checkpoint continuously records decisions, findings, commands, failures/backtracks, artifacts, exceptions, commits, immediate next step, validation, and closeout status; durable memory records removal conditions for exceptions. | Final checkpoint and memory review. | scrutiny | No waiver for implementation work using saved execution state. |

## Risks and Stop Conditions

- **Unsupported Next transitive range:** PostCSS 8.5.x and sharp 0.35.x are outside `next@16.2.11`’s published ranges. Any build/native/start/runtime regression blocks; do not normalize it as harmless merely because the non-Pi findings were removed.
- **Time-sensitive advisories:** new findings may appear between planning and implementation. Requery before edits and at final validation.
- **Lock churn:** sharp optional packages and patched Babel helpers can create many same-family records. Produce a semantic delta table and reject unrelated major or ecosystem-wide dedupe churn.
- **Published shrinkwrap:** Pi coding-agent’s nested lock controls what `npm ci` physically installs. The exact protobufjs remainder is accepted, not fixed; trust installed-path enumeration plus the published `0.81.1` shrinkwrap and reject a deceptively clean audit caused by root-record deletion.
- **Emoji peer mismatch:** no published wrapper supports React 19. Any attempted workaround beyond the bounded reviewed exception is out of scope.
- **Build-root collision:** `.next` is rooted in the complete selected project. Never build in a checkout serving `npm run dev`.
- **Native sharp:** platform packages may install but fail to load. The deployment-host generated-image smoke and production start are mandatory.
- **Private browser data:** use synthetic fixtures and sanitized evidence only.
- **Concurrent source state:** the supplied untracked count already drifted from 23 to 27. Preserve by ownership/path and do not clean unrelated files merely to restore a historical count.
- **Global deployment confusion:** source validation is not cutover approval. The user intentionally removed the Homebrew candidate, while the Pi-managed package and user-global Pi CLI `0.81.1` remain present. This task preserves those states; the local checkout launcher is the requested Pi Web runtime, and any later dotfiles cutover or global Pi update remains separate.
- **Launcher semantics:** `bin/pi-web.js` is already executable, but it is not a standalone binary. Moving it away from its complete built checkout will not work because it resolves local source, `node_modules`, and `.next`.

Stop and return for explicit review if:

- the latest stable Pi suite or its accepted protobufjs audit record differs from D-004;
- any implementation path requires manual root-lock editing, shrinkwrap bypass, a private Pi fork/repack, Pi `0.82+`, or hides the accepted installed copy;
- live advisory floors require D-005 values other than exact PostCSS `8.5.12` and sharp `0.35.0`;
- removing any production finding beyond D-004 requires a major/preview/canary dependency or any override beyond D-005;
- the Next override fails build/native/runtime validation;
- production or full audit has any finding beyond D-004’s exact accepted record;
- `npm ls --all` reports anything beyond the exact approved Emoji chain;
- lock churn includes unrelated major changes or cannot be explained;
- browser proof cannot be completed safely;
- source-main/global state changes unexpectedly; or
- the documented complete-checkout runtime cannot launch through its local executable without relying on global Pi Web package state.

## External Evidence Consulted

- Next July 2026 security release: <https://nextjs.org/blog/july-2026-security-release>
- Next `16.2.11` registry metadata: <https://registry.npmjs.org/next/16.2.11>
- Next local CLI: <https://nextjs.org/docs/app/api-reference/cli/next>
- npm `ci`: <https://docs.npmjs.com/cli/v11/commands/npm-ci/>
- npm scripts/local binaries: <https://docs.npmjs.com/cli/v11/commands/npm-run/>
- Mermaid advisory floor: <https://github.com/mermaid-js/mermaid/security/advisories/GHSA-87f9-hvmw-gh4p>
- DOMPurify current advisory floor: <https://github.com/cure53/DOMPurify/security/advisories/GHSA-c2j3-45gr-mqc4>
- brace-expansion current advisory: <https://github.com/advisories/GHSA-3jxr-9vmj-r5cp>
- protobufjs current advisory: <https://github.com/protobufjs/protobuf.js/security/advisories/GHSA-j3f2-48v5-ccww>
- sharp current advisory: <https://github.com/lovell/sharp/security/advisories/GHSA-f88m-g3jw-g9cj>
- Emoji Mart React wrapper metadata: <https://registry.npmjs.org/%40emoji-mart%2Freact/latest>
- Pi coding-agent `0.80.10` package metadata/tarball: <https://registry.npmjs.org/%40earendil-works%2Fpi-coding-agent/0.80.10>
- Pi coding-agent `0.81.1` package metadata/tarball: <https://registry.npmjs.org/%40earendil-works%2Fpi-coding-agent/0.81.1>

## Glossary

| Term | Kind | Where | What it does | State/lifetime |
|---|---|---|---|---|
| Open Implementation | Pi workflow transaction | Planning session -> `.agents/worktrees/` | Creates and opens the verified non-main checkout used for dependency edits. | One implementation session for this approved plan. |
| npm lock | Dependency resolution | `package-lock.json` | Pins exact npm packages, integrity data, optional platform artifacts, and dependency placement. | Tracked until a later dependency refresh. |
| Parent-scoped override | npm configuration | `package.json#overrides` | Replaces only named children of a named/versioned parent package. | Temporary compatibility policy; remove when stable Next metadata is fixed. |
| Published shrinkwrap | Nested dependency lock | `@earendil-works/pi-coding-agent` npm tarball | Pins the coding agent’s installed transitive tree and takes precedence over root override intent for its nested copies. | Changes only when upstream publishes a new package. |
| Peer dependency | Package compatibility declaration | `@emoji-mart/react` via `@lobehub/ui` | Declares which React versions the wrapper claims to support. | Warning persists until upstream release or separate migration. |
| Local build root | Complete Pi Web checkout | Worktree or explicit absolute root | Contains source, local `node_modules`, configuration, and generated `.next`. | Build artifacts are local and regenerable. |
| Checkout launcher | Executable Node script | `bin/pi-web.js` | Starts the built app using dependencies and `.next` from its complete checkout. | Tracked executable; not a portable standalone binary. |
| Global candidate | Deployment artifact | `/opt/homebrew/lib/node_modules/@agegr/pi-web` | Intentionally removed by the user and confirmed absent on 2026-07-23. | Must remain absent throughout this source task. |
| Pi-managed package | Deployment/runtime artifact | `~/.pi/agent/npm` | Existing older registry-managed Pi Web package. | Untouched until separate dotfiles uninstall approval. |
| User-global Pi CLI | Runtime executable | `/Users/xin/.local/bin/pi` | Reports Pi `0.81.1`; separate from this repo’s project-local npm declarations. | Read-only/out of scope; path/version only are snapshotted. |

## Decision Frontier

No unresolved product, security-policy, deployment, or design branches remain. The user explicitly approved all five **Approval Decision** items on 2026-07-23, including the exact published-Pi protobufjs exception and intentional absence of the Homebrew Pi Web candidate.

## Implementation Handoff

Approved plan path: `.agents/plans/2026-07-23-dependency-security-refresh.md`

```text
Open up implementation for .agents/plans/2026-07-23-dependency-security-refresh.md
```
