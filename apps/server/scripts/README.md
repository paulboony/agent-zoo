# Scripts

Zero-dep `.mjs` files. None import from the monorepo's TS source. None require a build step.

| Script | Purpose |
| --- | --- |
| `hook-handler.mjs` | Forwarder Claude Code spawns per hook event. Reads stdin, POSTs to `/hook`, exits 0 always (5s hard timeout). |
| `install-hooks.mjs` | Adds `owner: "claude-dashboard"` entries to `~/.claude/settings.json` for all 13 consumed events. Atomic write. Refuses to overwrite an unparseable settings.json. Preserves symlinks and file mode. |
| `uninstall-hooks.mjs` | Removes only entries with `owner: "claude-dashboard"`. Prunes empty arrays/keys. Atomic. |
| `doctor.mjs` | 9 diagnostic checks. `⚠` for soft warnings (foreign hook entries, empty projects dir). `✗` for hard failures. |
| `seed.mjs` | Generates synthetic hook envelopes for UI development. `--scenario demo` is the default. |

`hook-handler.mjs` is the only script that runs inside Claude Code's process. Keep it minimal and zero-dep.
