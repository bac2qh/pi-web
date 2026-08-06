# Running Session Status Projection

## 2026-08-06

- `AgentSessionWrapper` keeps native/wrapper event fanout depth as an internal cleanup and finality barrier, but browser-visible running membership is sampled only when the outer fanout returns to depth zero. Ordinary idle metadata events therefore never create a running frame.
- Projected native receipt outcomes can resolve after raw event delivery. Delayed callbacks publish only an actual idle release; they never use an intermediate active state to reclaim same-ID publisher authority.
- Native `agent_settled` is a session-level idle watermark rather than a one-attempt terminal. Before raw terminal fanout, the wrapper reserves every unreserved native-agent causal claim; a committed shared receipt retires that exact batch, rejection restores it, and reentrant starts remain outside it. Standalone manual compaction keeps one-claim terminal accounting.
- `wrapper_settled` publication is receipt-aware. The projected settled frame and final snapshot commit before the global running ID is removed, including reentrant cases where settlement queues behind a native terminal receipt.
- Same-ID authority is ordering-aware. Wrapper startup and prompt/compaction starts capture the current publisher baseline before projection/subscription reentrancy. Native fanout tracks each start request and its commit outcome; only the newest committed request may replace unchanged authority, while pending or rejected starts preserve an existing publisher. Ordinary and settlement publications also preserve another wrapper's authority.
- Publisher baselines pair the opaque publisher identity with an HMR-stable epoch stored in a `WeakMap`. The epoch distinguishes a newer reclaim by the same identity without retaining destroyed wrappers or adding protocol/persistence state.
- Deterministic regressions cover idle and nested metadata delivery, delayed rejected/committed receipts, pending starts, projected-final-before-idle ordering, terminal/start/prompt reentrancy, same-identity authority cycles, hosted success/failure, prompt and compaction failure/abort/overlap, destruction, retries, and initial/reconnected global-status views.
