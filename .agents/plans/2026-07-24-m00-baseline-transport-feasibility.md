# M0: Custom Server and Secure Gateway Foundation

Status: approved

## Objective

Give Pi Web ownership of its own server entry point so later milestones have a safe place to attach WebSockets. Today `bin/pi-web.js` hands server ownership to a spawned `next start`; after M0, one Pi-Web-owned Node server runs Next and exposes a secured but otherwise unused same-port WebSocket doorway.

Concretely, M0 implements the first retained production foundation from the approved [Pi Web Multi-Tab Transport Correction master](./2026-07-24-multi-tab-performance.md): one programmatic Next/Node server that can accept reserved WebSocket upgrades and share a versioned process-local gateway with App Router code.

M0 does **not** repeat the accepted HTTP/1.1/EventSource investigation and does not yet fix the browser stall. It converts the remaining server-boundary uncertainty into tested production code while leaving all current browser SSE behavior unchanged for the next milestone.

Success means:

- `npm run dev`, `npm start`, and the published `pi-web` command use one plain-Node custom server implementation;
- one Node `http.Server` owns both Next requests and reserved Pi Web WebSocket upgrades on the configured host/port;
- ordinary App Router routes, Next development HMR, and the reserved upgrade path coexist;
- a Next route and the plain-Node upgrade listener share a versioned `globalThis` gateway;
- same-origin bootstrap requests can issue one-use short-lived tickets for registered channels, and invalid/reused tickets fail closed;
- launcher options, browser opening, package contents, and clean teardown remain correct;
- no global-status/session browser migration, event projection, EventSource removal, or 30-minute runtime behavior enters this milestone;
- the milestone closes as a coherent foundation commit and exact handoff for the global-status migration.

## Design / Implementation Strategy

### 1. Add the direct server dependency without collateral lockfile churn

- Add `ws` as a direct runtime dependency and `@types/ws` as a development dependency.
- Update `package.json` and `package-lock.json` through npm-compatible tooling.
- Do not rewrite the already-stale `bun.lock`; it is not the current npm release authority and broad refresh would be unrelated scope.
- Keep the existing `build` command unchanged and never run it during development.

### 2. Replace the spawned Next child with one reusable custom server

Create `bin/pi-web-server.js` as a plain CommonJS server module that:

- constructs one Node `http.Server`;
- creates programmatic Next with the repository directory, mode, host, port, and owned HTTP server;
- delegates ordinary requests to `app.getRequestHandler()`;
- owns `WebSocketServer({ noServer: true, perMessageDeflate: false, maxPayload: 16 * 1024 })`;
- handles only a reserved path such as `/_pi/websocket` and leaves all other upgrades, including `/_next/webpack-hmr`, to Next;
- exports a testable `startPiWebServer(options)` result containing readiness, address, gateway, and idempotent `close()`;
- closes accepted Pi Web sockets, WebSocket server state, HTTP listener/connections, gateway state, timers, and Next in ownership order.

Refactor `bin/pi-web.js` into the thin CLI owner of this module and extend `bin/pi-web-options.js` with the internal `--dev` flag:

- retain `-p`/`--port`, `-H`/`--hostname`, `--no-open`, environment defaults, and current browser-opening behavior;
- add an internal/developer `--dev` launch mode;
- require `.next` only in production mode;
- open the browser after actual listen readiness rather than parsing child stdout;
- handle SIGINT/SIGTERM through the owned server's close path;
- preserve meaningful nonzero startup/close failure exits.

Use this same server boundary for:

- `npm run dev` as `node bin/pi-web.js --dev --no-open`;
- `npm start` as `node bin/pi-web.js --no-open`;
- the published `pi-web` command in production mode with current default browser opening.

Set `NODE_ENV` from the selected mode before loading Next so custom-server modules do not observe a stale environment.

M0 implements orderly close but leaves the master's final heartbeat, 30-minute semantic idle, slow-consumer handling, and ten-second forced-shutdown hardening to later milestones.

### 3. Install a versioned process-local gateway

Add `bin/pi-web-transport-gateway.js` as the plain-Node gateway and `lib/websocket-gateway.ts` as the typed App Router accessor.

The gateway:

- occupies one well-named versioned `globalThis` slot consistent with existing hot-reload-safe registries;
- has a random server-instance identity;
- supports explicit `registerChannel(name, handler)` / unregister behavior;
- issues opaque cryptographically random single-use tickets only for currently registered channels;
- stores ticket metadata server-side rather than trusting query metadata;
- expires unused tickets after 30 seconds;
- atomically consumes a ticket before upgrade dispatch;
- rejects duplicate registration, unknown channels, missing/expired/reused tickets, and gateway-version mismatch;
- clears tickets, handlers, and timers during server close;
- never logs raw ticket values.

M0 registers no production event channel. Focused integration tests register a temporary in-process test channel through the exported gateway API. The next milestone registers the real global-running-status channel.

### 4. Add the same-origin bootstrap route and upgrade validation

Add `app/api/transport/ticket/route.ts` as the one App Router POST endpoint that:

- requires `X-Pi-Web-Transport: 1`;
- requires a valid browser `Origin` whose host matches the request host;
- parses a small bounded JSON body containing the requested registered channel;
- asks the process gateway to issue a ticket;
- returns only the ticket and its short expiry metadata;
- returns bounded status/error codes without exposing registered channel internals, server paths, or secrets;
- sends no permissive CORS headers.

The reserved upgrade listener independently:

- validates path, host-bearing `Origin`, ticket presence, and ticket consumption;
- rejects the socket before `handleUpgrade` on failure;
- invokes only the server-side handler stored with the consumed ticket;
- does not claim or destroy non-Pi upgrade paths;
- redacts the ticket query value from diagnostics.

A custom request header makes cross-origin browser bootstrap require preflight; the route does not opt into it. This supplements, rather than replaces, upgrade-time origin and one-use-ticket validation.

### 5. Preserve current product behavior and document only the landed architecture

- Do not change `SessionSidebar`, `useAgentSession`, `rpc-manager`, either EventSource route, or current HTTP command/state/session APIs.
- No ordinary browser path requests a transport ticket in M0.
- Existing global and per-session SSE behavior therefore remains the rollback-compatible product path.
- Update `AGENTS.md` only where its launcher/server description becomes false.
- Do not add a wiki page for already-completed incident research.
- After successful implementation, distill the durable custom-server/gateway decision into project memory only if required by repository memory policy; do not copy execution chronology into memory.

### Scope estimate

- **Affected product surfaces:** `bin/pi-web.js`; `bin/pi-web-options.js`; new `bin/pi-web-server.js`; new `bin/pi-web-transport-gateway.js`; `package.json`; `package-lock.json`; new `app/api/transport/ticket/route.ts`; new `lib/websocket-gateway.ts`; focused `lib/*.test.mjs` launcher/gateway/server tests; launcher architecture notes in `AGENTS.md`; required checkpoint/memory bookkeeping.
- **Explicitly untouched surfaces:** browser components/hooks, `lib/rpc-manager.ts`, existing SSE routes, transcript/session APIs, Pi SDK monorepo, Next/React UI behavior.
- **Testability:** high for gateway, ticket, origin, upgrade, launcher options, same-process route sharing, package contents, and teardown; medium for HMR observation because no Playwright dependency is installed.
- **Implementation complexity:** medium-large but bounded to one server/launcher foundation.
- **Context estimate:** zero compactions expected; one maximum.
- **Scope-creep trigger:** adding a real running/session channel, browser transport consumer, event protocol, second listener port, private Next patch, or final lifecycle hardening stops work and returns to planning.

## Reference Files

- [Approved multi-tab transport master](./2026-07-24-multi-tab-performance.md)
- [Repository development instructions](../../AGENTS.md)
- [Current published launcher](../../bin/pi-web.js)
- [Launcher option parsing](../../bin/pi-web-options.js)
- [Package scripts, publish files, and dependencies](../../package.json)
- [Npm lockfile](../../package-lock.json)
- [Next configuration](../../next.config.ts)
- [Current global running SSE route](../../app/api/agent/running/events/route.ts)
- [Current per-session SSE route](../../app/api/agent/[id]/events/route.ts)
- [Current global registries and runtime ownership](../../lib/rpc-manager.ts)
- [Launcher option tests](../../lib/pi-web-options.test.mjs)

## Constraints and Scope

### Fixed constraints

- The user explicitly rejected an evidence-only milestone; M0 must land coherent production foundation code or stop blocked.
- The accepted browser HTTP/1.1/SSE diagnosis is not re-run or moved into wiki documentation.
- Planning mutates only this M0 plan until approval.
- Implementation begins only after this exact plan is approved and explicitly started.
- Work is confined to `/Users/xin/Documents/repos/pi-web`; `/Users/xin/Documents/repos/pi` is read-only reference and receives no changes.
- Preserve unrelated untracked plans, `.pi-subagents/`, and all user changes.
- Never run `next build` during development.
- Preserve current full-control Pi Web behavior and direct `http://localhost:30141` operation.
- Do not require HTTPS/TLS for local or LAN operation; the future browser client will derive `ws://`/`wss://` from its page.
- M0 closes out completely before the next milestone is drafted.

### In scope

- Direct `ws` dependency and npm lock update.
- Programmatic custom Next/Node server and thin CLI launcher.
- Same-port reserved WebSocket upgrade boundary.
- Versioned `globalThis` gateway and channel registration API.
- One-use 30-second bootstrap tickets.
- Same-host origin and custom-header bootstrap validation.
- Test-only registered channel used to prove route/gateway/upgrade behavior.
- Current CLI/script parity, HMR coexistence, package-file validation, idempotent close, and resource cleanup.
- Focused tests, necessary launcher documentation, checkpoint, implementation commit, handoff, and ordinary closeout.

### Out of scope

- Reproducing multi-tab incident evidence or adding an evidence wiki.
- Registering a production running-status or session channel.
- Migrating `SessionSidebar`, `ChatWindow`, `useAgentSession`, or any other browser code.
- Defining the production event/delta protocol.
- Removing or changing EventSource routes.
- Changing `AgentSessionWrapper`, runtime idle, SDK disposal, replay/backpressure, or hidden-session behavior.
- Implementing final ping/pong, 30-minute semantic idle, connection caps, slow-consumer policy, stale-instance reconciliation, or ten-second forced shutdown.
- Transcript/index/render/bundle optimization.
- A second production port, private Next monkeypatch, framework replacement, or Pi-monorepo change.

### Established facts

- The approved master is committed at `db7ba323de87c219fcd69eca68cc057151ed6656` and is non-executable.
- Current Pi Web is Next 16.2.11 on Node v24.18.0.
- `bin/pi-web.js` currently spawns `next start`, waits for “Ready” text to open a browser, and mirrors child exit.
- `package.json` currently runs direct `next dev`/`next start` and publishes the complete `bin/` directory.
- `ws` 8.21.0 is installed only transitively; production use requires a direct dependency.
- `globalThis` registries are already the project's established defense against Next hot-reload module replacement.
- Official Next custom-server documentation supports programmatic Next behind a user-owned Node HTTP server.
- Installed Next source leaves unmatched upgrade paths available for a custom WebSocket listener and owns HMR upgrades in development; M0 must verify coexistence empirically.
- No Playwright package is installed at repository root.
- Existing SSE/browser behavior need not change to validate the dormant custom server/gateway foundation.

### Blocked facts

- Production bundle regeneration and end-to-end validation against newly built `.next` output are blocked by the repository prohibition on `next build`; package/source/development validation substitutes in M0 and release build remains later responsibility.
- Automated browser HMR validation may be unavailable without adding a browser dependency, which is outside M0; a focused manual observation may be recorded instead.
- Independent subagent review remains unavailable while local `pi-subagents` cannot resolve `typebox/compile`; parent and ordinary review still apply.

## Test Strategy

### Static and package checks

Run:

```text
node_modules/.bin/tsc --noEmit
npm run lint
node --test lib/*.test.mjs
npm pack --dry-run
git diff --check
```

Verify:

- only intended paths changed;
- `ws` is a direct production dependency and `@types/ws` is development-only;
- every new runtime `bin/` module appears in the package dry-run;
- `bun.lock` remains untouched;
- no browser/event/runtime source outside scope changed.

### Isolated gateway tests

Cover:

- versioned global slot initialization and duplicate initialization;
- channel registration/unregistration and duplicate/unknown channel rejection;
- ticket entropy shape without asserting/logging values;
- 30-second expiry with fake time;
- atomic single-use consumption and reuse rejection;
- close clearing tickets, handlers, and timers;
- bounded errors without secret leakage.

### Custom-server integration tests

Start the exported server on an ephemeral loopback port and prove:

- ordinary Next/App Router request succeeds;
- a route-issued ticket is visible to the custom listener through shared gateway state;
- reserved-path `ws` upgrade succeeds for a test-only registered channel;
- same ticket reuse, wrong origin, missing custom bootstrap header, wrong path, unknown channel, and oversized inbound frame fail safely;
- non-Pi upgrade paths are not claimed by the custom listener;
- idempotent close releases Pi WebSockets, HTTP server, Next, gateway timers/state, and the port for rebind;
- repeated start/close does not leak listeners or global state.

### Launcher and development tests

- Extend launcher-option tests for development mode while preserving current flags/environment precedence.
- Verify `npm run dev` starts through the custom server and serves the app on 30141.
- Verify a normal browser load keeps Next HMR connected after a Pi reserved-path test connection.
- Verify `npm start -- --no-open` production startup behavior against the available existing `.next` artifact only to the extent safe; record new-route bundle validation as blocked until release build.
- Verify the published CLI opens the browser only after listen readiness; mock browser opening in automated tests.
- Send SIGINT/SIGTERM in a focused child-process test and verify bounded orderly exit for currently owned foundation resources; final forced-shutdown semantics remain later scope.

### Existing behavior regression

- Confirm current global and per-session EventSource routes still respond as before.
- Confirm no ordinary browser code calls the new bootstrap route.
- Confirm session browsing and a representative current prompt/stream path remain unchanged where safe.

### Documentation and state

- Update `AGENTS.md` launcher description after source behavior changes.
- Append required implementation evidence to the M0 checkpoint.
- Wiki update: **not applicable**; this milestone does not add a maintained user-facing concept beyond project development architecture.
- Memory update: include only the durable custom-server/gateway decision if repository memory policy requires it after successful implementation.

## Telemetry / Debuggability

M0 adds development-only sanitized foundation diagnostics, not a user-facing telemetry surface.

Allowed bounded signals:

- random server-instance identifier;
- startup/listen/close stage and bounded outcome;
- bootstrap ticket issue/consume/reject reason class;
- registered-channel and active Pi WebSocket counts;
- upgrade path class (`pi`, `non-pi`, `hmr`) without full URL/query;
- owned resource counts at close.

Never log:

- ticket values or full query strings;
- prompts, messages, tool payloads, media, provider payloads, credentials, auth material, raw session identifiers, or private filesystem paths.

## Validation Contract

| ID | Priority | Type/surface | Required truth | Required evidence | Validator mode | Blocker/waiver path |
|---|---|---|---|---|---|---|
| M0-VC-001 | P0 | Custom server | Programmatic Next, ordinary App Router requests, and reserved Pi Web WebSocket upgrades coexist on one owned Node HTTP server/port. | Focused integration test and development startup evidence. | scrutiny | Failure blocks the master design; no second-port or private-patch waiver. |
| M0-VC-002 | P0 | Process gateway | A Next route and custom upgrade listener share the versioned gateway; registered-channel dispatch and one-use ticket consumption are exact. | Route/upgrade integration tests with redacted outcomes. | scrutiny | Failure blocks progression and returns to master planning. |
| M0-VC-003 | P0 | Bootstrap security | Same-host origin, required custom header, registered channel, expiry, reuse, wrong-path, malformed-body, and oversized-frame checks fail closed without secret leakage. | Negative integration tests and static review. | scrutiny | No waiver for the bootstrap/upgrade boundary. |
| M0-VC-004 | P0 | Launcher/HMR | Dev/start/published-bin paths share one server implementation, preserve host/port/browser-open behavior, and do not break Next HMR. | Launcher tests, development run, HMR observation, and source review. | both | Automated HMR may be blocked by absent browser tooling; manual evidence is required instead. |
| M0-VC-005 | P0 | Package | Every runtime module and direct dependency required by the custom server is present in the npm package; unrelated lockfile content is untouched. | `npm pack --dry-run`, dependency tree, and final diff. | scrutiny | `next build` is not applicable by repository rule; package/source checks have no waiver. |
| M0-VC-006 | P0 | Lifecycle | Repeated start/close and signal paths release HTTP/WebSocket/Next/ticket/timer/global resources and permit port rebind. | Lifecycle integration tests and owned-resource evidence. | scrutiny | A leak blocks closeout; later hardening does not waive basic cleanup. |
| M0-VC-007 | P1 | Product compatibility | Existing SSE/browser/session behavior remains unchanged, and no production event channel/browser consumer is added. | Focused existing tests, route checks, representative user flow, and final source-boundary review. | both | Any migration requires a new scope decision. |
| M0-VC-008 | P0 | Execution state | Checkpoint and final summary record commands, test results, files, public gateway/server interfaces, implementation commit, blockers, and exact successor handoff. | Direct checkpoint/final-summary review. | scrutiny | Incomplete state blocks the next milestone. |

## Assumptions, Risks, and Blockers

- Programmatic custom-server code is not compiled by Next; it must remain plain Node-compatible CommonJS and be explicitly packaged.
- Next's custom-server route execution is expected to share process `globalThis`, but this is an empirical blocker gate.
- Multiple `upgrade` listeners receive the event; the Pi listener must ignore nonreserved paths while Next ignores the unmatched Pi path. HMR coexistence must be observed, not assumed.
- Query tickets are ephemeral secrets and may otherwise leak through request/error logs; diagnostics must redact full upgrade URLs.
- The route is dormant until a production channel is registered. It must fail safely rather than exposing a proof-only channel.
- Switching all launcher paths in M0 increases blast radius even though browser transport remains SSE; existing behavior and package tests are mandatory.
- The current production `.next` artifact cannot prove the new bootstrap route is in a release bundle. This residual risk remains explicit for release/M1 and does not authorize `next build`.
- Basic orderly close belongs here because the launcher now owns the server; final heartbeat, runtime idle, slow-consumer, stale-client, and forced-shutdown policy remains later scope.
- Any need for a second product port, undocumented Next modification, browser migration, or Pi-monorepo change stops implementation and returns to the master.

## Glossary

| Term | Kind | Where | What it does | State/lifetime |
|---|---|---|---|---|
| Custom server | Plain Node runtime module | `bin/` | Owns one HTTP server for Next requests and reserved Pi Web upgrades | Server-process lifetime |
| Process gateway | Versioned shared registry | `globalThis` via `bin/` and `lib/` accessors | Connects App Router bootstrap code to the plain-Node upgrade listener | Server-process lifetime; cleared on close |
| Registered channel | Server handler | Process gateway | Defines a channel eligible for a bootstrap ticket and upgrade dispatch | Explicit registration lifetime |
| Bootstrap ticket | Ephemeral authorization value | Bootstrap route and gateway | Authorizes exactly one registered-channel WebSocket upgrade | Single-use; expires after 30 seconds |
| Reserved path | WebSocket endpoint | Proposed `/_pi/websocket` | Distinguishes Pi Web upgrades from Next/HMR upgrades | Server-process lifetime |

## Implementation Handoff

No implementation is authorized while this plan is `Status: draft`.

After explicit shared-understanding approval, the executable plan path and command will be:

```text
/start-implementation .agents/plans/2026-07-24-m00-baseline-transport-feasibility.md
```
