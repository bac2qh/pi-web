# Dependency Security And Local Production Runtime

## 2026-07-23

- Dependency refresh commit `caaa1bd9393b9c5a4abfcf383f1fa99c2249e85c` updates Next/ESLint to `16.2.11`, Mermaid intent to `^11.15.0`, and project-local Pi AI/coding-agent/TUI intent to `^0.81.1` while keeping package identity `@agegr/pi-web@0.7.16`.
- The parent-scoped Next override is deliberately exact: `next@16.2.11` uses `postcss@8.5.12` and `sharp@0.35.0`. Remove or revise it only after a stable compatible Next line natively selects fixed versions and full build/native/runtime validation passes.
- The published Pi coding-agent shrinkwrap still installs `protobufjs@7.6.4`. Both production and full audit intentionally expose exactly its moderate `GHSA-j3f2-48v5-ccww` record at the nested coding-agent path; no private Pi fork, repack, manual lock surgery, or audit suppression is allowed.
- `npm ls --all` may remain nonzero only for `@emoji-mart/react@1.1.1` declaring React support through 18 while the app uses React 19. Do not hide it with legacy-peer-deps, force, or fabricated metadata.
- npm is authoritative for this refresh. `bun.lock` remains unchanged and unvalidated.
- The local production runtime is the complete checkout: local `node_modules`, `.next`, and executable `bin/pi-web.js`. After source or dependency changes, rerun `npm ci --include=dev`, validation, and `npm run build`; launch never rebuilds automatically.
