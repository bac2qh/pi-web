# OpenAI Fast Indicator Compatibility

## 2026-08-07 — Pi-Web-owned observer for a package-owned toggle

- Pi Web must not infer Fast state from configuration, startup notifications, provider payloads, or session history. `@benvargas/pi-openai-fast` owns its mutable state and request mutation, including `persistState: false` behavior and write failures.
- The accepted compatibility seam is deliberately narrow: authenticate the package-origin `fast` command through bounded nearest-manifest discovery, support only exact package version `1.1.0`, invoke only its `status` handler with a fresh command context, suppress the probe notification, and parse only its known bounded model-specific output shapes. Package absence means no indicator; an identified unsupported, ambiguous, stale, or failed contract means `unknown`.
- The adapter is wrapper-owned and transition-driven. It refreshes after extension binding, authenticated Fast-command settlement, model selection or settled model drift, and reload. It does not poll, watch configuration, probe on ordinary prompts, or probe merely because a browser reconnects.
- `pi-web:openai-fast-mode` is host-owned status transport metadata containing only `effective | unavailable | off | unknown`. Extension collisions are escaped as ordinary extension statuses, and the browser removes the host key before rendering generic statuses.
- Model changes are serialized in the wrapper. A `set_model` response carries the projected epoch/cursor after Fast convergence, and only exact epoch/cursor equality can complete that local browser transition. A later independent projection cannot satisfy an older response. When another caller or reconnect has advanced authority, the browser stays `unknown` until an exact-watermarked `get_state` response applies the authoritative model and Fast status together.
- `Fast` is the user-facing name; the accessible explanation names the underlying OpenAI `priority` service tier. `Fast` means the extension reports active and the freshly observed selected model is eligible; it does not claim that a future provider request succeeded.

References: `.agents/plans/2026-08-07-fast-mode-indicator.md`, `.agents/checkpoints/2026-08-07-fast-mode-indicator-checkpoints.md`, `AGENTS.md`, `lib/rpc-manager.ts`, `lib/openai-fast-mode-status.ts`, `hooks/useAgentSession.ts`, and `components/ChatInput.tsx`.
