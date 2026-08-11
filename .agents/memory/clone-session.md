# Clone Session Host Boundary

## 2026-07-28

- Pi Web exposes clone only as the exact built-in `/clone` command. It is a host action, never model input, steering, or follow-up content, including when images are attached or a run is active.
- Clone is deliberately non-replacing in the web host: the source session, wrapper, selected chat, URL, and sidebar state stay active. Success invalidates and refreshes the ordinary session list so the user can open the native child deliberately.
- `SessionManager.createBranchedSession(activeLeafId)` is authoritative for root-to-leaf contents, labels, the new native ID/file, and `parentSession`, but it mutates the manager it runs on. Pi Web must reopen the persisted source on a disposable manager and must first require the displayed leaf to equal the live wrapper leaf.
- The web clone does not emit Pi's replacement-runtime lifecycle events (`session_before_fork`, `session_shutdown`, or clone `session_start`). This intentionally omits extension preflight/cancellation because emitting only the pre-event could mutate the source that remains active.
- Pi 0.82.1 does not materialize a branch containing no assistant message. Pi Web reports **Nothing to clone yet** rather than retain a replacement runtime or serialize a web-owned session format.
- Every accepted prompt and compaction command owns an independent wrapper running claim before its first asynchronous preflight. Clone is rejected while any claim or native streaming/compaction state remains, preventing overlap under concurrent API/tab requests and out-of-order completion.
- Cold agent commands must reject and evict a cached session path that no longer exists before opening a manager; Pi otherwise interprets a missing explicit path as a new session.
- Keep the three operations distinct: **Fork / New session** copies history before a selected historical prompt and opens the child; `/clone` copies the complete displayed active branch and stays on the source; **Edit from here** branches inside the same JSONL file.

Reference: `.agents/plans/2026-07-21-clone-session.md`.

## 2026-08-11

- Approved a distinct Pi-Web-only `/side` contract; implementation has not started. `/side` will snapshot one invocation-time live branch, cut before any incomplete assistant tool-call batch, create a durable named native child, select it, and leave the source run unchanged.
- The side model keeps the safe inherited prefix as reference, while ordinary chat and branch presentation begin after a targeted hidden boundary. Full history remains the explicit complete-native-file exception.
- Side sessions are permanent ordinary tree nodes with manual Hide/Restore and a non-destructive Return-to-parent control. They are terminal for derived sessions: nested `/side`, `/clone`, and Fork are blocked, while same-file Edit from here remains allowed inside the boundary subtree.
- Side runtimes are investigative: ordinary inspection/workspace tools remain, but known subagent and Start/Orchestrate launching extensions are removed as capabilities. Workspace mutation remains available only under the post-boundary instruction policy, not a hard filesystem sandbox.

Reference: `.agents/plans/2026-08-11-active-session-side-conversations.md`.
