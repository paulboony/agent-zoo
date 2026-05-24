# Agent Zoo

A localhost dashboard that watches your Claude Code sessions and
sub-agents in real time. Animated mascots show what each agent is doing;
browser notifications fire when one needs your attention.

Read-only by design. The dashboard observes; it doesn't drive.

## Quick start

### Running the published package

```bash
# One-time (per machine):
#   1. Default `gh` scope is `repo` only — installing from a private
#      GH Packages registry needs `read:packages` too.
gh auth refresh --scopes read:packages,repo

#   2. Point npm at GitHub Packages for the @paulboony scope, with
#      the gh token for auth.
echo '@paulboony:registry=https://npm.pkg.github.com' >> ~/.npmrc
npm config set //npm.pkg.github.com/:_authToken="$(gh auth token)"

# Run it.
npx @paulboony/agent-zoo
```

That single command installs hooks into `~/.claude/settings.local.json`, boots
the bundled server, and opens the dashboard at <http://127.0.0.1:5173>.

Flags: `--port`, `--web-port`, `--no-open`, `--no-install-hooks`.

> The package is private while it stabilises. When it goes public
> (see [Building & publishing](#building--publishing)) the one-time
> setup above will no longer be needed.

### Running from source (development)

```bash
pnpm install
pnpm install-hooks   # adds entries to ~/.claude/settings.local.json
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
- **Themes** — `default` (SVG pixel art), `Final Fantasy V`
  (sprite-sheet, 16×24 cells), `Final Fantasy` (sprite-sheet, 20×24
  cells), `Super Mario Bros.` (sprite-sheet, NES HUD-style card).
  Switch via the picker in the header.
- **Worktree badge** — sessions whose `cwd` is a linked git worktree
  (vs the main checkout) show a small `GitBranch` badge with the
  main-repo path on hover. Detected at session start via
  `git rev-parse --git-dir`.
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
| `pnpm build` | Alias for `build:dist` — produces the publishable artifact |
| `pnpm build:dist` | Bundle server + build web + copy scripts into `dist/` |
| `pnpm build:workspaces` | `turbo run build` across the workspace |
| `pnpm start` | Build the publish bundle and run it (API on `:7777`, web on `:5173`). No hook install or browser-open — `pnpm install-hooks` + your browser do that separately. |
| `pnpm install-hooks` | Configure `~/.claude/settings.local.json` |
| `pnpm uninstall-hooks` | Remove this dashboard's hook entries |
| `pnpm doctor` | Diagnostic checks |
| `pnpm seed` | Generate fake hook events for UI development |
| `pnpm test` | Playwright e2e |
| `pnpm test:unit` | Vitest server unit tests |
| `pnpm test:pack` | End-to-end smoke test of the publishable artifact |
| `pnpm typecheck` | `tsc -b` across the workspace |
| `pnpm lint` | Biome |

## Adding things

| What | Where |
| --- | --- |
| New theme | Folder under `apps/web/src/themes/<id>/` with `theme.json`, `mascots.css`, `preview.png`, and either `mascots/<kind>.svg` files (svg mode) or `mascots/sprites.png` + `mascot_sprite` spec (sprite mode) |
| Label-driven mascot rule | Append to `LABEL_RULES` in `apps/web/src/lib/mascot-kind.ts` |
| Notification event | `apps/web/src/hooks/use-notifications.ts` (keys, defaults, dispatcher) and `apps/web/src/components/settings/notifications-section.tsx` (EVENTS array) |
| Mascot kind | `apps/web/src/lib-theme/types.ts` `MascotKind` union, plus per-theme assets |

## Building & publishing

The package is published to **GitHub Packages** (private, scoped to
`@paulboony`). `publishConfig.registry` in `package.json` pins all
`npm publish` runs to `https://npm.pkg.github.com` so they can't
accidentally land on npmjs.com.

### Layout of the publishable artifact

`pnpm build:dist` produces:

```
dist/
├── server.mjs            esbuild bundle of apps/server (266 KB, zero runtime deps)
├── web/                  vite build output (apps/web/dist/ copied here)
└── scripts/
    ├── hook-handler.mjs        runtime entry CC spawns per hook event
    ├── post-with-retry.mjs     retry helper imported by the handler
    ├── install-hooks.mjs       writes ~/.claude/settings.local.json
    └── uninstall-hooks.mjs     removes our entries
```

Tarball is ~340 KB packed, 17 files. The published package has
**zero runtime `dependencies`** — pino, hono, etc. are all bundled by
esbuild.

### One-time setup (per machine, before your first publish)

The default `gh` token only has `repo` scope. Publishing to GH Packages
needs `write:packages` too:

```bash
gh auth refresh --scopes write:packages,read:packages,repo
```

Then wire npm to use GitHub Packages for the `@paulboony` scope, with
the gh token for auth:

```bash
echo '@paulboony:registry=https://npm.pkg.github.com' >> ~/.npmrc
npm config set //npm.pkg.github.com/:_authToken="$(gh auth token)"

# Verify.
npm whoami --registry=https://npm.pkg.github.com
# → should print: paulboony
```

### Package the artifact

```bash
pnpm build:dist
```

Cleans `dist/`, bundles the server, builds the web, copies the
runtime scripts. Idempotent — safe to re-run.

To see what `npm publish` would actually ship without publishing:

```bash
npm pack --dry-run
```

### Test the local artifact

**The gate before any publish:**

```bash
pnpm test:pack
```

Builds, packs a tarball, installs it into a scratch tmpdir, boots the
bin on alt ports (17777/15173), and exercises every user-facing
surface — API direct, web static, web→API proxy, SPA fallback,
`POST /hook` reducer round-trip. ~10s. Exits non-zero on the first
failure with the child's stderr included. If this passes, the
artifact a real `npx @paulboony/agent-zoo` user will see also works.

**Interactive — try it like a real user:**

```bash
pnpm build:dist
npm pack
mkdir -p /tmp/agent-zoo-try && cd /tmp/agent-zoo-try
npm init -y > /dev/null
npm install /Users/paul/git/paulboony/agent-zoo/paulboony-agent-zoo-*.tgz
./node_modules/.bin/agent-zoo
```

Pass `--no-install-hooks` if you don't want it touching your real
`~/.claude/settings.local.json`, or set `CLAUDE_HOME=/tmp/fake-claude` to
sandbox it.

Cleanup after the interactive try:

```bash
cd /Users/paul/git/paulboony/agent-zoo
rm paulboony-agent-zoo-*.tgz
rm -rf /tmp/agent-zoo-try
pnpm uninstall-hooks   # if you let it install hooks
```

**Fastest iteration loop** — straight from `dist/`, no pack/install:

```bash
pnpm build:dist
node bin/agent-zoo.mjs --no-install-hooks
```

### Cut a release

```bash
# 1. Clean tree on master.
git status
git pull --ff-only

# 2. Gate: prove the artifact runs end-to-end.
pnpm test:pack

# 3. Bump version. Creates a git commit + tag locally; does not push.
npm version patch    # 0.1.0 → 0.1.1
# Or:  npm version minor   (0.1.0 → 0.2.0)
# Or:  npm version major   (0.1.0 → 1.0.0)

# 4. Publish. `prepublishOnly` runs `pnpm build:dist` automatically,
#    so the tarball is always built from fresh source.
npm publish

# 5. Push the version commit + tag to GitHub.
git push --follow-tags
```

### Verify the release landed

```bash
npm view @paulboony/agent-zoo versions --registry=https://npm.pkg.github.com
```

Or open <https://github.com/paulboony/agent-zoo/packages> in the
browser.

### Test the published version like a stranger

After the one-time setup, from any directory:

```bash
npx @paulboony/agent-zoo
```

That should pull from GH Packages, install hooks, boot the server,
open the dashboard at <http://127.0.0.1:5173>.

### Unpublish (within 24h only)

```bash
npm unpublish @paulboony/agent-zoo@<version> --registry=https://npm.pkg.github.com
```

After ~24h GH Packages only allows deprecation, not removal.

### When you're ready to make it public

Two paths.

**Stay on GitHub Packages, flip access to public** — keeps the
registry config friction for users (`.npmrc` line still required to
find `@paulboony/*`). Edit `package.json`:

```json
"publishConfig": {
  "registry": "https://npm.pkg.github.com",
  "access": "public"
}
```

**Or move to npmjs.com** — zero registry config for end users; the
default registry just works. Edit `package.json`:

```json
"publishConfig": {
  "registry": "https://registry.npmjs.org",
  "access": "public"
}
```

Then `npm login` (against npmjs.com), `npm publish`. After that,
`npx @paulboony/agent-zoo` works on any machine with no setup.

Recommended for public: **npmjs.com**. GH Packages is fine for private
but the `.npmrc` step is friction you don't want strangers to face.

## License

TBD.
