# pi-web

[中文文档](./README.zh-CN.md)

Local web UI for the [pi coding agent](https://github.com/badlogic/pi-mono). pi-web reads your local pi session files and gives you a browser workspace for session browsing, real-time chat, model configuration, skill management, and project file preview.

![Pi Web shows the same pi session with structured Markdown, tool calls, and project navigation beside the CLI](https://raw.githubusercontent.com/agegr/pi-web/main/docs/screenshot2.png)

The same pi session in CLI and pi-web: structured tool calls, readable Markdown, session browsing, and cleaner results.

## Quick Start

**Run without installing:**

```bash
npx @agegr/pi-web@latest
```

**Or install globally:**

```bash
npm install -g @agegr/pi-web
pi-web
```

Then open [http://localhost:30141](http://localhost:30141). The CLI will try to open the browser automatically after the server is ready.

**Options:**

```bash
pi-web --port 8080              # custom port
pi-web --hostname 127.0.0.1     # local access only
pi-web -p 8080 -H 127.0.0.1     # combine options
pi-web --no-open                # do not open the browser automatically

PORT=8080 pi-web                # environment variable is also supported
PI_WEB_NO_OPEN=1 pi-web         # useful when running as a background service
```

## Features

- **Pick work back up**: browse previous pi conversations by project without digging through terminal history or session paths.
- **Keep important work close**: pin sessions across projects, use the rolling ten-day Recent list, or hide unwanted fork subtrees from the sidebar and reveal them temporarily with Show hidden.
- **Try different directions safely**: edit from an earlier message, fork before a historical prompt, or run `/clone` to copy the complete active branch.
- **Work across branches**: switch Git worktrees from the sidebar so new sessions and the Explorer follow the checkout you choose.
- **Chat beside the project**: browse files on the left and preview source, docs, images, audio, and PDFs on the right while the agent works.
- **See session state clearly**: context usage, cost, compaction state, and system prompt details are visible from the top bar.
- **Configure less from the terminal**: manage models, login/API keys, model tests, and skill switches from the web UI.

## Notes

- **Data directory**: pi-web reads `~/.pi/agent/sessions` by default. Set `PI_CODING_AGENT_DIR` to point at another pi agent directory.
- **Session files**: files are stored as `~/.pi/agent/sessions/<encoded-cwd>/<timestamp>_<uuid>.jsonl`.
- **Sidebar state**: pins and explicit hidden markers are shared by pi-web clients through `pi-web-sidebar.json` in the pi agent directory. Hiding is presentation-only: it does not move or rewrite session JSONL files, change pins, or stop a running session. Pi Web does not expose permanent session deletion.
- **Model config**: the Models panel reads and writes `models.json` in the pi agent directory. Model lists and defaults come from pi's config.
- **File access**: file browsing and preview are scoped to the selected project directory and working directories that appear in sessions.
- **Git worktrees**: see [Worktrees in pi-web](./docs/worktrees.md) for when the switcher appears, how new worktrees are created, and what removal does.
- **Branch operations**: "Edit from here" creates a branch inside the current session file. Fork creates a child `.jsonl` from before the selected historical prompt and opens it. `/clone` creates an ordinary child session containing the complete active branch through the current position; pi-web refreshes the sidebar but stays on the source session.
- **Clone host boundary**: `/clone` uses Pi's native session-file extraction and ancestry format, but it does not replace the live web session or emit the TUI's fork/clone extension lifecycle events.

## Development

### Local Pi fork prerequisite

This checkout intentionally uses a local, untracked coding-agent tarball built from `bac2qh/pi` commit `734502cb86eaf631e1ceeb403dbd717e3b78404f`. It does not use the global Pi installation and is not publishable in this form.

Use Node `24.19.0` and npm `11.17.0`, and keep the retained main checkouts as siblings:

```text
<repos>/pi-web/
<repos>/pi/
```

The sibling `pi` checkout must be clean, its `origin` must identify `bac2qh/pi`, and `HEAD` must be the exact commit above. From retained `pi-web` main, run:

```bash
npm run build:local-pi-fork
npm run install:local-pi-fork
npm run dev
```

The helper creates two fresh exact-commit builds, runs the fork checks, tests, build, local-release path, and focused faux-provider compaction regression, then requires byte-identical archives before atomically publishing:

```text
../pi/.artifacts/pi-web/734502cb8/bac2qh-pi-coding-agent-0.84.0-bac2qh.734502cb8.tgz
```

That artifact is ignored by the fork and must be rebuilt locally; it is never installed globally or fetched from a custom package release. To avoid mutable model-catalog input, the helper hydrates generated model data from the unchanged official `@earendil-works/pi-ai@0.84.0` artifact before running the exact fork validation path. `npm run install:local-pi-fork` verifies the on-disk artifact identity and committed integrity before running scripts-disabled `npm ci`, so a warm npm cache cannot hide a missing or stale sibling prerequisite. It never falls back to the registry coding-agent; rerun the build helper (and preserve or remove only the exact stale artifact if it reports a byte mismatch).

The committed `file:../pi/...` path is relative to retained `pi-web` main. A nested managed checkout under `.agents/worktrees/` does not have that sibling layout; validate it in a disposable `pi-web`/`pi` sibling copy rather than creating a fake worktree or changing the manifest path.

The local dev server runs at [http://localhost:30141](http://localhost:30141).

Common checks:

```bash
node_modules/.bin/tsc --noEmit
npm run lint
```

Avoid running `next build` / `npm run build` during local development. It writes to `.next/` and can interfere with the dev server; leave builds for release work.

## Project Structure

```text
app/
  api/
    agent/          # creates/drives AgentSession and exposes SSE events
    auth/           # OAuth and API key management
    cwd/validate/   # custom working directory validation
    default-cwd/    # pi default working directory lookup
    files/          # file listing, reading, preview, and watching
    home/           # current user home directory
    models/         # available models, default model, thinking levels
    models-config/  # read/write models.json and test models
    sessions/       # session reads, rename, context, HTML export
    sidebar-state/  # shared pin/hide operation API
    skills/         # skill listing, search, install, enable/disable
components/
  AppShell.tsx        # main layout, URL state, top panels, file tabs
  SessionSidebar.tsx  # Pinned/Recent/Project sections and Explorer
  ChatWindow.tsx      # messages, SSE, image drag/drop, minimap
  ChatInput.tsx       # input bar, model/tools/thinking/compact/slash controls
  MessageView.tsx     # message, thinking, tool call/result rendering
  ModelsConfig.tsx    # model and auth configuration panel
  SkillsConfig.tsx    # skill management panel
  FileExplorer.tsx    # file tree
  FileViewer.tsx      # source, diff, image, audio, PDF, DOCX preview
lib/
  rpc-manager.ts      # AgentSessionWrapper lifecycle and global registry
  session-reader.ts           # parses .jsonl session files and branch contexts
  sidebar-session-state.ts    # pure pin/hide/recent/tree derivation
  sidebar-state-store.ts      # locked atomic pi-web-sidebar.json storage
  normalize.ts                # normalizes toolCall field names
  file-access.ts      # file read safety boundary
  file-paths.ts       # path encoding and relative path helpers
  markdown.ts         # Markdown/Mermaid/KaTeX plugin configuration
  pi-types.ts         # pi-related types
hooks/
  useAgentSession.ts  # session loading, command sending, SSE state machine
  useAudio.ts         # completion sound
  useDragDrop.ts      # image drag/drop
  useTheme.ts         # theme switching
bin/
  pi-web.js           # npm CLI entrypoint
```
