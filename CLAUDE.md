# Agent Zoo — repo notes for Claude Code

Read-only localhost dashboard for live Claude Code sessions and their
sub-agents. The dashboard observes; it doesn't drive Claude Code.

## Layout

```
apps/
  server/   Hono + tsx watch; receives /hook POSTs, broadcasts via SSE.
  web/      Vite + React 18; consumes SSE, renders the dashboard.
packages/
  shared/   AgentState / SessionState / HookPayload types.
docs/       Architecture, stack, scope, hooks/state notes.
tests/      Playwright (only e2e; no unit-test framework).
```

`pnpm` workspaces + `turbo run dev --parallel`. Node ≥ 20.12.

## Data flow

```
Claude Code hooks ──> hook-handler.mjs ──> POST /hook
                                                │
                                          reduce(store, env)
                                                │
                                          in-memory Store (Map<sessionId, SessionState>)
                                                │
                                          SSE  /stream
                                                │
                                          Zustand store in browser
                                                │
                                          <Dashboard /> -> <SessionDetail /> -> <AgentNode />
```

Backfill: on boot the server scans `~/.claude/projects/**.jsonl` (last
24h, last 200 lines per file) to rebuild state. For each recovered
session, it then walks `<session-id>/subagents/agent-*.meta.json` +
`agent-*.jsonl` (Claude Code's on-disk sub-agent transcripts) and
restores those sub-agents as `status: "ended"` with their `label`,
`prompt`, `tool_calls_count`, and `model`. Live hook events overwrite
the ended state for sub-agents that are actually still running.
`refreshMainAgentModels` re-scans every 30 s to fill in `agent.model`
for sessions whose backfill missed it.

## Common change targets

| Goal | File |
|---|---|
| Add an `AgentKind` | `packages/shared/src/state.ts` (union) + theme `mascots/<kind>.svg` for each SVG theme + `rows.<kind>` in each sprite theme + `validate.ts` REQUIRED_KINDS + `registry.ts` KIND_FILES + optionally a rule in `lib/agent-kind.ts` LABEL_RULES |
| Add a label → mascot rule | `apps/web/src/lib/agent-kind.ts` (LABEL_RULES) |
| Add a notification event | `use-notifications.ts` (PREF_KEYS + DEFAULT_PREFS + dispatchNotifications) + `notifications-section.tsx` EVENTS + spec types |
| Add a theme | New folder under `apps/web/src/themes/<id>/` with `theme.json`, `mascots.css`, `preview.png`, `mascots/*.svg` for SVG mode or `mascots/sprites.png` for sprite mode |
| Add a hook event | `packages/shared/src/hooks.ts` HookEventName + `reducer.ts` applyTransition case |

## Themes & mascots

- Theme has either `mascot_mode: "svg"` (per-kind SVG files in `mascots/`)
  or `"sprite"` (one `mascots/sprites.png` plus a `mascot_sprite` spec
  in `theme.json`).
- Sprite spec: `cell { width, height }`, optional `gap { x?, y? }` and
  `padding { x?, y? }`, `rows: Record<AgentKind, number>`, `states:
  Record<MascotState, { frames: number[]; fps? }>`. Each state's
  `frames` is an array of column indices (can be non-contiguous).
- Mascot CSS variables (`--row`, `--frame-N`, `--stride-x/y`, `--pad-x/y`,
  `--dur`) come from inline styles on `.mascot-sprite`. Theme's
  `mascots.css` only needs the keyframes (`sprite-2`, `sprite-3`,
  `sprite-4`) — `<Mascot>` does the math.
- UI mascot kind is resolved by `resolveDisplayKind(agent)` in
  `apps/web/src/lib/agent-kind.ts`. Order: `main` → label regex match →
  `"general"`. Label is the parent's Task `tool_input.description`,
  correlated by `tool_use_id` == `subagent.agent_id` in `reducer.ts`.

## Notifications

- Master bell in the header gates everything (`localStorage["dashboard.notifications.enabled"]`).
- Five per-event prefs under `localStorage["dashboard.notifications.<event>"]`:
  `waiting_for_human`, `session_error`, `session_start`, `session_complete`, `subagent_spawn`.
- Events are edge-triggered against `lastTransition.prevStatus` / `isNew` / `newAgentIds`.
- `session_error` and `waiting_for_human` bypass focus-suppression and use
  `requireInteraction: true` so banners persist.
- Foreground-tab only — no Web Push, no service worker.

## Running

```
pnpm install
pnpm install-hooks         # writes ~/.claude/settings.json entries
pnpm dev                   # turbo run dev --parallel
pnpm doctor                # diagnostic
```

`.claude/launch.json` has one `app` config; Claude Preview tooling runs
the whole stack via `pnpm dev`.

## Tests

Two suites:

- **Unit (`pnpm test:unit`)** — vitest in `apps/server`. Currently
  covers the sub-agent backfill parsers and orchestrator
  (`apps/server/src/backfill.test.ts`). No web-side vitest yet.

- **E2E (`pnpm test`)** — Playwright. `tests/happy-path.spec.ts`
  covers session list, sub-agent tree, theme switch, dashboard
  landing, and the settings page. Tests run against the running dev
  server (`reuseExistingServer: true` locally). The seed script
  `apps/server/scripts/seed.mjs` populates a demo session with one
  main agent plus five sub-agents — one per label-rule mascot kind
  plus an ended reviewer behind "Show ended".

## Conventions / gotchas

- Don't run `nvm use` / source `nvm.sh`. `node`, `pnpm`, `turbo` are on
  PATH already.
- Use `git -C <path>` for git operations against other worktrees; never
  `cd <path> && git ...` (hard-coded permission prompt).
- `agent_type` is the raw Claude Code subagent type string (e.g.
  `"general-purpose"`, `"Explore"`). The UI mascot kind is derived
  client-side from `agent.label` via `resolveDisplayKind` — see
  `apps/web/src/lib/agent-kind.ts`. `agent.label` (description) is
  preferred for display text too.
- `SubagentStop` sets `agent.status = "ended"` (not `"idle"` — a
  prior fix). Ended sub-agents are hidden behind a toggle in
  `SubAgentSection`.
- Vite serves theme files from each theme folder via
  `import.meta.glob(eager: true)`. Adding a new theme folder requires
  a dev-server restart (not just HMR) to be discovered.
- `useNow` uses a singleton interval via `useSyncExternalStore`. Every
  card subscribes; only one timer runs.

## Docs

`docs/superpowers/specs/` and `docs/superpowers/plans/` are
gitignored (`docs/superpowers/`) — they're working artefacts. The
non-superpowers `docs/` (architecture, stack, scope, hooks-and-state)
are the long-form references.
