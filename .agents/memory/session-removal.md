# Pi Web Session Removal Policy

## 2026-08-05

- Pi Web intentionally removed permanent session deletion from both the sidebar and `app/api/sessions/[id]`. Reversible Hide/Restore is the only web workflow for removing sessions from normal sidebar views; unsupported DELETE requests use Next's ordinary method-not-allowed response rather than an alias or compatibility handler.
- The decision followed an observed deletion path that destroyed a live wrapper and invalidated extension contexts without `session_shutdown`, while surviving extension work could still reference that stale context. Removing the observed trigger was preferred over adding graceful-teardown machinery to this feature.
- Hide/Restore remains presentation metadata only: it does not rewrite or unlink JSONL, reparent descendants, change pins, close or navigate away from a selected chat, stop running work, or dispose a wrapper.
- This decision does not claim graceful shutdown parity for other native-disposal paths. A stale-context failure outside permanent deletion requires separate evidence and a separately approved change.
