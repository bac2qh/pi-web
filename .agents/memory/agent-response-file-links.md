# Agent Response File Links

## 2026-08-05 — Automatic actions remain stricter than authored links

- Plain and whole-inline-code file paths are recognized only in settled assistant text. User messages, custom messages, fenced code, existing Markdown anchors, and streaming assistant text do not enter the automatic transform.
- Automatic resolution is lexical and anchored to the exact session cwd. Relative traversal, absolute paths outside that cwd, the main checkout from a linked-worktree session, sibling worktrees, host-like URLs, binary/media names, unknown extensions, and arbitrary extensionless names stay inert.
- Existing authored Markdown links deliberately keep their prior broader resolver and file-authorization behavior. Do not narrow `resolveLocalFileHref()` to implement automatic-action policy; use the strict automatic resolver.
- A supported text/source extension remains eligible regardless of basename. Otherwise `.env.*` and `Dockerfile.*` accept only explicit established variant labels, so an arbitrary or binary-looking suffix cannot bypass the source/text policy.
- Ambiguous unquoted whitespace-path fragments remain inert through candidate-looking suffixes until shared punctuation or a lowercase prose connector establishes a new clause. Quoted and whole-inline-code paths are the reliable form for spaces.
- The route language map and automatic source/text eligibility live together in `lib/file-types.ts`. Text preview remains capped at 256 KiB and the authoritative read rejects NUL or invalid UTF-8 before browser rendering.

## 2026-08-05 — Narrow activation and presentation are separate policies

- Generated assistant path actions open directly only at widths of at least 1000px. Below 1000px, `AppShell` owns one pending confirmation captured with session ID and cwd and revalidates both before opening.
- Every committed file open—Explorer, authored Markdown, nested viewer link, or confirmed generated action—uses full application width below 1000px: existing mobile presentation through 640px and automatic expanded presentation from 641px through 999px.
- Expansion state preserves manual desktop intent separately from automatic narrow intent. Narrow restore suppression lasts until another file-open action; returning to desktop clears only automatic expansion; closing the final tab clears all expansion state.

## References

- Plan: `.agents/plans/2026-08-05-agent-response-file-links.md`
- Checkpoint: `.agents/checkpoints/2026-08-05-agent-response-file-links-checkpoints.md`
