# Agent Zoo

A localhost dashboard that watches your Claude Code sessions and
sub-agents in real time. Animated mascots show what each agent is doing;
browser notifications fire when one needs your attention.

Read-only by design. The dashboard observes; it doesn't drive.

## Quick start

```bash
pnpm install
pnpm install-hooks   # adds entries to ~/.claude/settings.json
pnpm dev             # http://localhost:5173
```

Run `pnpm doctor` if something looks off.

## Features

- **Live session list** in the collapsible sidebar — newest event first,
  status-coloured. Click a session card to see its agent tree.
- **Sub-agent grouping** — each session's sub-agents render in their own
  section. Ended ones are hidden behind a toggle to keep the active
  group readable.
- **Mascots per agent kind** — different sprite for `main`,
  `code-reviewer`, `explorer`, `writer`, `coder`, `general`. Resolution
  prefers the sub-agent's Task description (`"Final review of feature"`
  → reviewer, `"Implement auth"` → coder, etc.), so the realistic
  Claude Code flow of dispatching everything as `general-purpose` still
  shows differentiated mascots.
- **Themes** — `Clawd` (SVG pixel art), `Final Fantasy V` (sprite-sheet,
  16×24 cells), `Final Fantasy` (sprite-sheet, 20×24 cells). Switch via
  the picker in the header.
- **Settings page** at `/settings` with per-event notification switches
  (waiting-for-human, session errors, session starts, completes,
  subagent spawned). The bell icon in the header is the master toggle.
- **Foreground-tab notifications only** — no service worker, no Web
  Push. Closing the tab silences them.

## Stack

pnpm workspaces • Turborepo • TypeScript • Hono • Vite • React 18 •
Tailwind v4 • shadcn/ui • Biome • Playwright

## How it works

Claude Code fires lifecycle hooks. A tiny standalone forwarder
(`hook-handler.mjs`) POSTs them to a local Hono server. The server keeps
an in-memory tree of sessions → agents → activity, and pushes updates
to the browser over SSE. On startup, the server scans recent JSONL
transcripts under `~/.claude/projects/` to rebuild state.

See [`CLAUDE.md`](CLAUDE.md) and `docs/` for architecture details.

## Scripts

| Script | Purpose |
| --- | --- |
| `pnpm dev` | Hono server + Vite client in parallel |
| `pnpm dev:hooks` | `install-hooks` then `dev` |
| `pnpm build` | Production build |
| `pnpm start` | Run built app |
| `pnpm install-hooks` | Configure `~/.claude/settings.json` |
| `pnpm uninstall-hooks` | Remove this dashboard's hook entries |
| `pnpm doctor` | Diagnostic checks |
| `pnpm seed` | Generate fake hook events for UI development |
| `pnpm test` | Playwright e2e |
| `pnpm typecheck` | `tsc -b` across the workspace |
| `pnpm lint` | Biome |

## Adding things

| What | Where |
| --- | --- |
| New theme | Folder under `apps/web/src/themes/<id>/` with `theme.json`, `mascots.css`, `preview.png`, and either `mascots/<kind>.svg` files (svg mode) or `mascots/sprites.png` + `mascot_sprite` spec (sprite mode) |
| Label-driven mascot rule | Append to `LABEL_RULES` in `apps/web/src/lib/mascot-kind.ts` |
| Notification event | `apps/web/src/hooks/use-notifications.ts` (keys, defaults, dispatcher) and `apps/web/src/components/settings/notifications-section.tsx` (EVENTS array) |
| Mascot kind | `apps/web/src/lib-theme/types.ts` `MascotKind` union, plus per-theme assets |

## License

TBD.
