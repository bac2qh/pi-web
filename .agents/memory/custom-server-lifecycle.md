# Custom Server And Process-Scoped Development

## 2026-07-30

- Pi Web owns one plain-Node HTTP server in `bin/pi-web-server.js`. Programmatic Next handles ordinary requests on that server, while Pi Web claims only `/_pi/websocket`; every unmatched upgrade remains available to Next development HMR or another owner.
- The dormant V1 transport gateway lives in the exact process-global slot `globalThis.__piWebTransportGatewayV1`. App Router code accesses that object structurally rather than constructing a second runtime. Occupied missing-version or falsy slot values are incompatible state, not absence.
- A channel must be registered before the same-origin ticket route can issue a 32-byte opaque ticket. Tickets are authoritative server-side records, expire after 30 seconds, are deleted before validation/dispatch, and are revoked on unregister or close. Bootstrap and upgrade independently reject malformed Host authorities, cross-host Origins, missing authorization, reuse, and bounded-body/frame violations without logging ticket values.
- `startPiWebServer().close()` is an idempotent, non-exiting library boundary. It stops acceptance, terminates Pi WebSockets, closes WebSocket/HTTP state and tracked raw connections, clears gateway registrations/tickets/timers and the exact global, awaits only public Next `app.close()`, reports bounded owned-resource counts, and aggregates observable failures.
- Next 16.2.11 development is deliberately process-scoped. Its public close leaves internal Watchpack file watchers referenced; do not inspect or close those private handles. The executed terminal launcher awaits public/Pi-owned cleanup and then exits `130` for the first SIGINT or `143` for the first SIGTERM; cleanup or startup failure exits `1`. Imported launcher/server APIs never terminate their embedding process.
- Production does not use the development Watchpack path and must remain reusable in one process: start, close, restart on the same port, close again, and drain naturally. Lifecycle validation may copy a pre-existing pinned production artifact, but that stale fixture cannot prove freshness or inclusion of newly added routes.
- M0 registers no production WebSocket channel and adds no browser consumer. Existing global and per-session SSE remain authoritative until the separately approved global-status migration; do not infer an event protocol, replay policy, browser migration, heartbeat, or forced-shutdown deadline from this foundation.

## 2026-08-06

- The post-M0 migration now registers three HMR-safe production channels on the same gateway: page-global `running`, metadata-bound `session`, and metadata-bound `file-watch`. Global/session/file persistent EventSources and both agent SSE routes are removed; short-lived OAuth login SSE remains the sole intentional browser EventSource.
- Browser bootstrap uses same-host one-use tickets whose server records hold authoritative session or file context. The gateway admits 64 Pi Web sockets per direct peer and 256 total, never trusts forwarded peer headers, bounds channel output/replay, and disconnects slow subscribers without blocking agent work.
- Every live wrapper owns one projected state/event hub independent of browser subscribers. True text/thinking/tool/lifecycle effects carry monotonic sequence/epoch state; bounded replay resumes ordinary gaps and canonical snapshots recover initial, overflow, wrong-epoch, and final state. HTTP transcript/state reconciliation remains the authoritative repair net.
- Mounted file views use the same allowed-root-or-session-reference authorization as file GET. Each consumed subscription owns one bounded watcher and path-free connected/change frames; reconnect reauthorizes, and socket/path/view/server teardown releases the watcher.
- Semantic wrapper idle is 30 minutes. Accepted commands and native/projected activity touch it, heartbeat does not, and active prompt/compaction/streaming/binding/hosted work cannot expire. The server owns one 30-second ping/pong heartbeat and one ten-second natural-drain coordinator before force-releasing only residual Pi-owned resources.
- Subsequent production-route, live-tip transcript, and stale-running-status corrections preserve this transport boundary. Final user acceptance is practical rather than a claim that the exact combined 30-socket S7 matrix was reconstructed; consult the S7 report/checkpoint for accepted departures.

## 2026-08-08

- Server shutdown now starts published `AgentSession` semantic cleanup at the existing gateway runtime-owner boundary and observes its shared promise. The original absolute ten-second socket/connection deadline remains independent: natural drain and residual Pi-owned force complete on that clock before server close strictly awaits extension `session_shutdown` handlers, final gateway cleanup, and public Next cleanup. A nonsettling handler may therefore keep semantic close pending after network resources settle, but it cannot delay or reset network force.

## 2026-08-18

- The fixed semantic wrapper idle window is now 12 hours, superseding the earlier 30-minute default. Existing semantic touches, passive-activity exclusions, active-work deferral, and authoritative explicit/server shutdown remain unchanged; this longer window reduces but does not eliminate interruption risk for async subagent work.

## 2026-08-31

- Native launch now defaults to literal `127.0.0.1:30141` without consulting generic `HOSTNAME`. Ordinary Pi Web remains local-only; explicit non-Serve `--hostname` compatibility remains while the external wrapper is active.
- Opt-in `--tailscale-serve` starts the loopback backend first, then one directly spawned attached foreground `tailscale serve` child whose selected HTTPS port equals the backend port. HTTPS and WebSocket upgrades share that listener. Serve rejects port `0`, port `443`, and non-loopback hostname overrides before resources start.
- The launcher recognizes only the bounded post-configuration marker, discards all child stdout/stderr, and owns exact-child cleanup. Programmatic close uses `SIGINT`; terminal `SIGINT`/`SIGTERM` is preserved. Startup failure rolls back all started owners, and unexpected ready-child exit closes the runtime; only the executed terminal entry exits nonzero, while imported callers receive a non-rejecting `failure` lifecycle promise.
- Pi Web performs no Tailscale status/config inspection, broad cleanup, recovery, or unrelated-owner signaling. `SIGKILL`, power loss, and a surviving orphan cannot run cleanup; a later collision fails safely and requires external operator action rather than inferred ownership.

## 2026-09-01

- Unix-like Tailscale launch now uses Node's `detached` spawn mode solely to put the directly invoked `tailscale` launcher and its inherited descendants in one private process group. The command remains foreground and attached; Windows preserves direct-child signaling, and no path parses the launcher or discovers processes.
- Intentional cleanup sends one normal signal to the still-owned group or child, waits ten seconds for the direct child's `close`, optionally sends one `SIGKILL` to that same still-owned target with one warning, and waits ten more seconds. The direct child's `exit` first clears signaling ownership; only `close` confirms cleanup. An unconfirmed result rejects an embedded close and makes the terminal launcher exit `1` after other owned resources settle.
- A launched Tailscale command that exits after readiness now produces one private-access warning while the loopback Pi Web backend remains available. Pi Web does not restart Tailscale; the existing non-rejecting `failure` promise reports the lifecycle result without exiting an embedding process.
