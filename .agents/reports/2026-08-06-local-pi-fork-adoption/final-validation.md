# Local Pi Fork Adoption — Final Validation

Date: 2026-08-07
Plan: `.agents/plans/2026-08-06-local-pi-fork-adoption.md`

## Selected artifact

- Source checkout: sibling `bac2qh/pi`, clean `main`, exact `HEAD` `734502cb86eaf631e1ceeb403dbd717e3b78404f`.
- Installed identity: compatibility key `@earendil-works/pi-coding-agent` → actual `@bac2qh/pi-coding-agent@0.84.0-bac2qh.734502cb8`.
- Artifact: sibling ignored `.artifacts/pi-web/734502cb8/bac2qh-pi-coding-agent-0.84.0-bac2qh.734502cb8.tgz`.
- Size/files: 5,072,824 bytes; 956 packed files.
- SHA-256: `f5a5caf1f5d34e9830480afb5707b5dc412a0e10a3016349240904bc12a47de2`.
- SHA-512: `sha512-T/AN5JeYYvGiDU7uupAkgiibNLD3Q8iUzQTpG401YJ9IbCIMsZE8ICtTdEcnGWaPqtwsP1UkNFH9VMOeJnchYw==`.
- Package metadata, repository, `gitHead`, package/shrinkwrap root identity, `dist`, and the fork-specific `_checkCompactionBetweenTurns` marker all matched.

## Exact-source and reproducibility gate

Final command: `npm run build:local-pi-fork` from the task checkout, publishing only to retained-main sibling artifact state.

Each of two independent runs:

- required Node `24.19.0`, PATH Node `24.19.0`, and npm `11.17.0`;
- disabled Git replacement objects, checkout hooks, and external global/system attributes;
- rejected repository-local info attributes;
- materialized the exact detached commit and verified all 1,340 tracked file objects and executable modes before and after the build;
- allowed exactly the declared `pi-test.bat` and `pi-test.ps1` CRLF checkout transforms;
- ran scripts-disabled `npm ci` under isolated HOME/Pi/XDG/npm state;
- integrity-verified official `@earendil-works/pi-ai@0.84.0` before hydrating 39 ignored generated model-data files;
- passed fork checks, TypeScript/browser smoke, all workspace builds, the complete isolated suite, local-release packing, and the focused faux-provider regression;
- reported coding-agent `1877 passed / 49 skipped` and focused between-turn compaction `14 passed`;
- reproduced the local-release coding-agent tarball from a fresh stage, then changed only root `package.json` and `npm-shrinkwrap.json` identity metadata.

The two final archives were byte-identical and matched the already-published archive and committed lock integrity. A cleanup audit found six stale Git registrations from an earlier macOS `/tmp` versus `/private/tmp` identity bug; the helper now canonicalizes through the nearest existing ancestor, the six exact task-owned stale registrations were removed, and the final full run left neither a registration nor a `piwpf-734502cb8-*` directory.

One post-cleanup validation attempt stopped on the fork's unrelated `footer-data-provider` reftable watcher timeout after coding-agent reported `1876 passed / 49 skipped` with one failure. The helper removed its complete temporary state. The immediate unchanged full retry passed both independent builds at `1877 passed / 49 skipped` plus both 14-test focused runs and reproduced the exact digest; the earlier repeated successful runs corroborate that this was a transient filesystem-watch test flake rather than an adoption regression.

## Clean local rehydration and dependency graph

In an owned disposable `pi-web`/`pi` sibling layout:

- `npm run install:local-pi-fork` preflighted the physical artifact and committed lock, then completed `npm ci --ignore-scripts --include=dev` under an ambient `NODE_ENV=production`.
- The explicit `--include=dev` correction retained TypeScript/ESLint in that environment; the clean install added 1,074 packages.
- Runtime `VERSION` was `0.84.0-bac2qh.734502cb8`; installed package name/repository/`gitHead` were the approved fork values.
- `npm ls` displayed `@earendil-works/pi-coding-agent@npm:@bac2qh/pi-coding-agent@0.84.0-bac2qh.734502cb8`.
- AI, TUI, agent-core, client, protocol, and telemetry resolved only at exact official `0.84.0`; the focused Pi tree exited zero.
- Full `npm ls --all` remained nonzero only for the established `@emoji-mart/react@1.1.1` React-through-18 peer declaration against React 19.

## Installed-fork lifecycle

`lib/local-pi-fork-integration.test.mjs` ran from the clean disposable installation, not the nested worktree's ancestor dependencies. It asserted the installed fork `VERSION`, used only synthetic faux-provider credentials/messages/tool data, and observed:

```text
agent_start
  < threshold compaction_start
  < non-aborted threshold compaction_end
  < continued message_end
  < agent_end
  < agent_settled
  < one projected run_settled + one final snapshot
  < one global idle publication
```

At `compaction_end`, the wrapper and global projection were still running and no final projection existed. Direct native subscription preceded wrapper construction; no projected finality or global idle was observed before native `agent_settled`. The final projected/global running lifecycle was balanced exactly once.

## Pi Web validation

All commands used the disposable installed graph and isolated HOME/Pi/XDG/npm state unless they were source-only Git checks.

- `node_modules/.bin/tsc --noEmit`: pass.
- `npm run lint`: pass.
- Canonical `NODE_ENV=test node --test` over all 63 `*.test.mjs` files: 736/736 pass.
- Focused helper, packaged lifecycle, credential cache, RPC settlement, projector/view transport, hosted implementation, and clone suites: pass.
- `git diff --check`: pass.
- `bun.lock`: unchanged.
- `package.json#scripts.release`: unchanged.
- `npm run build` in the disposable copy with unrelated ambient `TURBOPACK` removed: pass on Next 16.2.11/webpack; only the established dynamic export-route warning remained.
- Two separate production launcher cycles each loaded `/`, `/api/models`, and `/api/sessions`, then completed SIGTERM shutdown with exit 143.
- The complete Node suite independently exercised real Next development startup/HMR/rebind and copied production restart/drain lifecycle.

Two invalid ambient invocations were characterized rather than hidden: `NODE_ENV=production` disables React's test-only `act`, so the canonical suite was rerun with `NODE_ENV=test`; `TURBOPACK=auto` conflicts with the explicit `--webpack` build flag, so it was removed for the successful build. The transient fork watcher timeout and stale-registration cleanup correction are recorded in the exact-source section above.

## Audit comparison

- Original pre-change audit: 6 findings (`brace-expansion`, Mermaid, Next, PostCSS, plus old coding-agent/Undici).
- Final production/full audit: 5 findings, 3 moderate and 2 high (`brace-expansion`, DOMPurify, Mermaid, Next, PostCSS).
- DOMPurify's advisory appeared in npm's live database during implementation. Re-auditing the untouched pre-change lock against the same current database produced 7 findings including the same DOMPurify advisory plus old coding-agent/Undici. Its locked `3.4.12` entry is byte-for-byte unchanged, so this is external advisory drift, not adoption churn.
- The local adoption removes the old coding-agent/Undici findings and introduces no dependency-audit regression relative to a same-time old-lock comparison.

## Isolation and preservation

- No npm global install/update/uninstall, Git remote write, tag, release, package publish, real provider call, or real user credential/config/session-content read occurred.
- Build, install, tests, development/production runtime, npm cache/config, and synthetic Pi state used task-owned temporary roots.
- `/opt/homebrew/bin/pi` remained version `0.84.0`; its symlink and target file metadata matched the pre-implementation snapshot exactly.
- The named real `~/.pi`, sessions-root, settings symlink, and models symlink metadata matched the snapshot. Only the immediate `~/.pi/agent` directory mtime changed; this is consistent with transient lock/history entries from the required post-check and the active Pi harness. No named configuration target changed.
- Three exact npm debug logs created by early nonzero `npm ls` probes before isolation was tightened were identified from captured stderr and removed; no unrelated npm log was touched.
- The sibling fork remained clean at the exact commit; its pre-existing unrelated managed worktree remained registered, and helper worktrees were removed.

## Independent review and residual risk

- Four-lane review workflow `call_CAr61bgG10Cr0amq9oXm8iF5|fc_028afed9d9f29597016a760392102481939f936ed93b202b8a` found no lock/runtime-auth/doc regressions and identified helper/lifecycle hardening items that were fixed.
- Follow-up workflow `call_VnT260OWyZDJGoXPs5VJwA0n|fc_028afed9d9f29597016a76082371288193b87d5f6f05b8cbcb` found the lifecycle contract clean and drove stricter Git attribute/mode checks.
- Final reviewer `8451c27e-1f6b-48cf-9a50-ad4aada6c59d` found only replacement-object handling; `GIT_NO_REPLACE_OBJECTS=1` is now forced centrally and in nested validation, with regression coverage and a final successful two-build run.
- The ignored local artifact and sibling checkout remain mandatory machine-layout prerequisites by design.
- Same-user malicious replacement of an artifact ancestor directory during the narrow publication syscall window is outside this cooperative local-helper threat model. Stable symlinks, canonical escape, differing existing artifacts, and concurrent destination creation are rejected; publication never replaces an existing destination.
- The manifest remains deliberately non-publishable until a separately approved change restores a self-contained coding-agent dependency.
