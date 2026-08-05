# Live Session Transcript Reconciliation

## 2026-08-05

- `activeLeafId` records the leaf displayed by Pi Web's branch UI; it is not itself evidence of an intentional historical selection. HTTP selected-context reads use a separate synchronous pinned-leaf intent. A null pin means root transcript repair follows the advancing native live tip.
- Explicit navigation installs the pin before asynchronous work, increments the leaf generation, and serializes native `navigate_tree` commands. Selecting a user or custom-message entry uses that entry's native parent as the base for a subsequent replacement prompt.
- Starting a normal model prompt synchronously releases a historical pin before optimistic mutation. A definitive pre-execution failure may restore the prior pin only while that transition remains current. Extension slash commands preserve the pin because they are host commands rather than new model descendants.
- Coalesced root/context repairs re-read current pin intent when they execute, cancel delayed opposite-authority retries when urgent repair arrives, and retain reconciliation token guards. Projected completion effects remain transient; HTTP transcript repair is the authoritative convergence path after recovery cannot replay an effect.
- A normal prompt installs a transcript floor. Persisted coverage requires a distinct matching user entry rather than content equality with a pre-existing entry. Current compaction evidence can retire the exact-entry floor when native compaction replaces the prompt path with a summary; recovery-cloned old compaction state cannot.
- The correction is intentionally browser-local. It adds no server route, WebSocket protocol, event journal, persistence format, or duplicate transcript store.
- Residual interface limits: a missed genuinely new compaction start followed by a semantically identical completion cannot be distinguished from the old completion, and a distinct same-content entry proves persistence novelty but cannot correlate request provenance across concurrent identical clients.

Reference: `.agents/plans/2026-08-05-live-tip-transcript-reconciliation.md`.
