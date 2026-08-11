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

- Pi Web implements exact `/side` as a separate host operation from `/clone`: it captures one immutable live branch, cuts before the earliest unresolved assistant tool-call batch, transactionally creates and names a durable native child, selects it, and leaves the source wrapper/run untouched. Native regenerated label IDs are verified with stable non-label identity plus the extracted candidate leaf.
- One strict targeted hidden marker makes the inherited safe prefix model-visible but removes it and the marker from ordinary chat and branch presentation. Malformed, duplicate, conflicting, off-branch, cyclic, or dangling marker state fails closed. Side compaction renders a generic notice, while Full history remains the intentional complete-native-file exception.
- Side children are permanent ordinary tree nodes with manual Hide/Restore and a non-mutating Return-to-parent control resolved from native ancestry. Slow creation and metadata responses are guarded by mounted session and leaf-generation identity so they cannot steal a newer selection.
- A valid side is terminal for Pi-Web-owned derivation: nested `/side`, `/clone`, and Fork are blocked at the wrapper, and direct plus extension navigation stays inside the marker subtree. Same-file Edit from here remains available after the boundary.
- Side runtimes keep ordinary inspection/workspace tools but remove whole extensions that register the exact subagent or Start/Open/Orchestrate launch capabilities and defensively exclude known delegation tool names across startup, tool changes, reload, tools-off, reopen, and restart. The mandatory policy treats inherited work as reference-only and permits workspace mutation only after an explicit post-boundary request; unrestricted `bash` means this is not a hostile-shell session-file sandbox.

Reference: `.agents/plans/2026-08-11-active-session-side-conversations.md`.
