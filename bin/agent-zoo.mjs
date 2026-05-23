#!/usr/bin/env node
/**
 * agent-zoo CLI — single-command launcher for the dashboard.
 *
 * Boots the bundled server (API on :7777 + static web on :5173),
 * registers Claude Code hooks against ~/.claude/settings.json so the
 * dashboard immediately sees events, and opens the dashboard in the
 * default browser. Each step is logged so the user can see what
 * happens.
 *
 * Flags:
 *   --port <n>         API port (default 7777, env PORT)
 *   --web-port <n>     Web port (default 5173, env WEB_PORT)
 *   --no-open          Skip opening a browser
 *   --no-install-hooks Skip writing hook entries to settings.json
 *   --help             Show usage
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(HERE, "..");
const SERVER_BUNDLE = path.join(PKG_ROOT, "dist", "server.mjs");
const WEB_DIR = path.join(PKG_ROOT, "dist", "web");
const INSTALL_HOOKS = path.join(PKG_ROOT, "dist", "scripts", "install-hooks.mjs");

const args = process.argv.slice(2);
const flags = {
  port: process.env.PORT ?? "7777",
  webPort: process.env.WEB_PORT ?? "5173",
  open: true,
  installHooks: true,
};
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--port") flags.port = args[++i] ?? flags.port;
  else if (a === "--web-port") flags.webPort = args[++i] ?? flags.webPort;
  else if (a === "--no-open") flags.open = false;
  else if (a === "--no-install-hooks") flags.installHooks = false;
  else if (a === "--help" || a === "-h") {
    process.stdout.write(`agent-zoo — Claude Code session dashboard

Usage:  agent-zoo [options]

Options:
  --port <n>           API port (default 7777, env PORT)
  --web-port <n>       Web port (default 5173, env WEB_PORT)
  --no-open            Don't open a browser on startup
  --no-install-hooks   Don't write hook entries to ~/.claude/settings.json
  -h, --help           Show this help

After startup the dashboard is reachable at  http://127.0.0.1:<web-port>
`);
    process.exit(0);
  } else {
    process.stderr.write(`agent-zoo: unknown option "${a}". Try --help.\n`);
    process.exit(2);
  }
}

const step = (msg) => process.stdout.write(`\x1b[36m▸\x1b[0m ${msg}\n`);
const ok = (msg) => process.stdout.write(`\x1b[32m✓\x1b[0m ${msg}\n`);
const warn = (msg) => process.stdout.write(`\x1b[33m!\x1b[0m ${msg}\n`);
const fail = (msg) => process.stderr.write(`\x1b[31m✗\x1b[0m ${msg}\n`);

async function runChild(cmd, argv, { env, label } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, argv, {
      stdio: "inherit",
      env: { ...process.env, ...env },
    });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${label ?? cmd} exited ${code}`));
    });
    child.on("error", reject);
  });
}

function openBrowser(url) {
  // Best-effort cross-platform open. Errors are non-fatal — if the
  // user's OS doesn't have a default launcher, the URL is printed
  // below anyway and they can click it themselves.
  const cmd =
    process.platform === "darwin" ? "open"
    : process.platform === "win32" ? "cmd"
    : "xdg-open";
  const argv = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    const child = spawn(cmd, argv, { stdio: "ignore", detached: true });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (!existsSync(SERVER_BUNDLE)) {
    fail(`server bundle missing at ${SERVER_BUNDLE}`);
    fail("This package may be installed incorrectly. Try reinstalling.");
    process.exit(1);
  }

  // 1. Install hooks so Claude Code starts emitting to the dashboard.
  if (flags.installHooks) {
    step("Installing Claude Code hooks in ~/.claude/settings.json…");
    try {
      await runChild(process.execPath, [INSTALL_HOOKS], { label: "install-hooks" });
      ok("Hooks installed (or already present).");
    } catch (err) {
      warn(`Hook install failed: ${err.message}`);
      warn("Continuing without hooks — events won't reach the dashboard.");
    }
  } else {
    step("Skipping hook installation (--no-install-hooks).");
  }

  // 2. Spawn the bundled server.
  step(`Starting server  API :${flags.port}  web :${flags.webPort}`);
  const server = spawn(
    process.execPath,
    [SERVER_BUNDLE],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        NODE_ENV: "production",
        PORT: String(flags.port),
        WEB_PORT: String(flags.webPort),
        WEB_DIR,
      },
    },
  );
  server.on("exit", (code) => {
    if (code !== 0 && code !== null) {
      fail(`Server exited with code ${code}.`);
    }
    process.exit(code ?? 0);
  });

  // 3. Open the dashboard once the server has had a beat to bind.
  const url = `http://127.0.0.1:${flags.webPort}`;
  if (flags.open) {
    setTimeout(() => {
      step(`Opening ${url}`);
      const opened = openBrowser(url);
      if (!opened) warn(`Couldn't auto-open a browser; visit ${url} manually.`);
    }, 800);
  } else {
    step(`Browser auto-open disabled. Dashboard at ${url}`);
  }

  // 4. Forward Ctrl-C / SIGTERM so the child server gets a clean shutdown.
  const forward = (signal) => () => {
    step(`Received ${signal}, shutting down…`);
    server.kill(signal);
  };
  process.on("SIGINT", forward("SIGINT"));
  process.on("SIGTERM", forward("SIGTERM"));
}

main().catch((err) => {
  fail(err.stack ?? String(err));
  process.exit(1);
});
