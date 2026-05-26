#!/usr/bin/env node
/**
 * Pre-publish smoke test.
 *
 * Pipeline:
 *   1. Build dist/ (esbuild + vite + script copies).
 *   2. `npm pack` to produce a tarball that mirrors what publish would
 *      ship.
 *   3. Install that tarball into a scratch tmpdir.
 *   4. Spawn the installed `agent-zoo` bin against a fake CLAUDE_HOME,
 *      with browser-open and hook-install skipped.
 *   5. Wait for /healthz to be reachable.
 *   6. Exercise every surface a user actually touches:
 *        - GET /healthz                (API direct, port 7777-ish)
 *        - GET /api/sessions           (API direct)
 *        - GET /                       (web static index.html)
 *        - GET /api/sessions           (proxy via web port)
 *        - GET /sessions/<random>      (SPA fallback)
 *        - POST /hook with a synthetic SessionStart, then
 *          GET /api/sessions/<sid>     (round-trip via the reducer)
 *   7. Tear down: SIGINT the child, wait for clean exit, rm tmpdir +
 *      tarball.
 *
 * Exits non-zero on any failure, with the child process's stderr/
 * stdout printed so you see why.
 */
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const API_PORT = process.env.SMOKE_API_PORT ?? "17777";
const WEB_PORT = process.env.SMOKE_WEB_PORT ?? "15173";
const BOOT_TIMEOUT_MS = 15_000;

const c = {
  step: (m) => process.stdout.write(`\x1b[36m▸\x1b[0m ${m}\n`),
  ok: (m) => process.stdout.write(`\x1b[32m✓\x1b[0m ${m}\n`),
  fail: (m) => process.stderr.write(`\x1b[31m✗\x1b[0m ${m}\n`),
};

function run(cmd, args, { cwd = ROOT, env, capture = false } = {}) {
  return new Promise((resolve, reject) => {
    const stdio = capture ? "pipe" : "inherit";
    const child = spawn(cmd, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio,
    });
    let out = "";
    let err = "";
    if (capture) {
      child.stdout.on("data", (d) => (out += d.toString()));
      child.stderr.on("data", (d) => (err += d.toString()));
    }
    child.on("exit", (code) => {
      if (code === 0) resolve({ out, err });
      else reject(new Error(`${cmd} ${args.join(" ")} exited ${code}\n${err}`));
    });
    child.on("error", reject);
  });
}

async function waitForPort(host, port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://${host}:${port}/healthz`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`server at ${host}:${port} did not become ready within ${timeoutMs}ms`);
}

async function assertOk(label, fn) {
  try {
    await fn();
    c.ok(label);
  } catch (err) {
    c.fail(`${label} — ${err.message}`);
    throw err;
  }
}

async function main() {
  c.step("Building publish artifact (build:dist)…");
  await run("pnpm", ["build:dist"]);

  c.step("Packing tarball…");
  const packed = await run("npm", ["pack", "--silent"], { capture: true });
  const tarballName = packed.out.trim().split(/\s+/).pop();
  if (!tarballName?.endsWith(".tgz")) {
    throw new Error(`unexpected pack output: ${packed.out}`);
  }
  const tarballPath = path.join(ROOT, tarballName);
  c.ok(`Packed ${tarballName}`);

  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "agent-zoo-smoke-"));
  const fakeHome = path.join(scratch, "fake-claude");
  await fs.mkdir(fakeHome, { recursive: true });

  let child;
  let exitCode = 1;
  try {
    c.step(`Installing tarball into ${scratch}`);
    await run("npm", ["init", "-y"], { cwd: scratch, capture: true });
    await run("npm", ["install", "--no-audit", "--no-fund", tarballPath], {
      cwd: scratch,
      capture: true,
    });
    const binPath = path.join(scratch, "node_modules", ".bin", "agent-zoo");
    await fs.access(binPath);
    c.ok("Bin symlinked at node_modules/.bin/agent-zoo");

    // Sanity: invoke install-hooks via the packaged bin against the
    // fake CLAUDE_HOME. Catches builds that forgot to include a
    // sibling .mjs (e.g. hooks-edit.mjs) — the script would crash at
    // import time, which the runtime smoke test wouldn't notice
    // because it runs with --no-install-hooks for safety below.
    const installHooksPath = path.join(
      scratch,
      "node_modules",
      "@paulboony",
      "agent-zoo",
      "dist",
      "scripts",
      "install-hooks.mjs",
    );
    await fs.access(installHooksPath);
    const installResult = await run("node", [installHooksPath], {
      cwd: scratch,
      env: { CLAUDE_HOME: fakeHome },
      capture: true,
    });
    if (!installResult.out.includes("settings.json")) {
      throw new Error(
        `install-hooks output didn't mention settings.json:\n${installResult.out}`,
      );
    }
    await fs.access(path.join(fakeHome, "settings.json"));
    c.ok("install-hooks writes settings.json");

    c.step(`Spawning agent-zoo (API :${API_PORT}, web :${WEB_PORT})`);
    child = spawn(binPath, ["--no-open", "--no-install-hooks"], {
      cwd: scratch,
      env: {
        ...process.env,
        CLAUDE_HOME: fakeHome,
        PORT: API_PORT,
        WEB_PORT,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let childOut = "";
    let childErr = "";
    child.stdout.on("data", (d) => (childOut += d.toString()));
    child.stderr.on("data", (d) => (childErr += d.toString()));

    const exited = new Promise((resolve) =>
      child.on("exit", (code) => resolve(code ?? -1)),
    );

    await waitForPort("127.0.0.1", API_PORT, BOOT_TIMEOUT_MS);
    c.ok("API listener reachable");
    await waitForPort("127.0.0.1", WEB_PORT, BOOT_TIMEOUT_MS);
    c.ok("Web listener reachable");

    const api = `http://127.0.0.1:${API_PORT}`;
    const web = `http://127.0.0.1:${WEB_PORT}`;

    await assertOk("GET /healthz (API direct)", async () => {
      const res = await fetch(`${api}/healthz`);
      const body = await res.json();
      if (!body.ok) throw new Error(`unexpected body: ${JSON.stringify(body)}`);
    });

    await assertOk("GET /api/sessions (API direct)", async () => {
      const res = await fetch(`${api}/api/sessions`);
      const body = await res.json();
      if (typeof body.seq !== "number" || !Array.isArray(body.sessions)) {
        throw new Error(`unexpected snapshot shape: ${JSON.stringify(body)}`);
      }
    });

    await assertOk("GET / serves index.html (web static)", async () => {
      const res = await fetch(`${web}/`);
      const txt = await res.text();
      if (!txt.includes("<!doctype html>") && !txt.includes("<!DOCTYPE html>")) {
        throw new Error(`index.html missing doctype, got: ${txt.slice(0, 80)}`);
      }
    });

    await assertOk("GET /api/sessions via web (proxy → API)", async () => {
      const res = await fetch(`${web}/api/sessions`);
      const body = await res.json();
      if (typeof body.seq !== "number" || !Array.isArray(body.sessions)) {
        throw new Error(`proxy returned bad shape: ${JSON.stringify(body)}`);
      }
    });

    await assertOk("GET /sessions/<random> falls back to index.html", async () => {
      const res = await fetch(`${web}/sessions/${crypto.randomUUID()}`);
      if (res.status !== 200) throw new Error(`expected 200, got ${res.status}`);
      const txt = await res.text();
      if (!txt.includes("Agent Zoo")) {
        throw new Error("SPA fallback didn't include the app title");
      }
    });

    const synthSid = `smoke-${crypto.randomUUID()}`;
    await assertOk("POST /hook ingests, reducer commits, snapshot reflects", async () => {
      const env = {
        received_at: new Date().toISOString(),
        payload: {
          hook_event_name: "SessionStart",
          session_id: synthSid,
          cwd: "/tmp/smoke",
          transcript_path: "",
          source: "startup",
        },
      };
      const post = await fetch(`${api}/hook`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(env),
      });
      if (post.status !== 204) {
        throw new Error(`POST /hook returned ${post.status}`);
      }
      // The reducer commits synchronously inside the POST handler,
      // so the GET below should see the new session immediately.
      const res = await fetch(`${api}/api/sessions/${synthSid}`);
      if (!res.ok) throw new Error(`GET session returned ${res.status}`);
      const body = await res.json();
      if (body.session?.id !== synthSid) {
        throw new Error(`expected id ${synthSid}, got ${body.session?.id}`);
      }
      if (body.session.status !== "running") {
        throw new Error(`expected status running, got ${body.session.status}`);
      }
    });

    // Verify the round-trip also works via the web proxy.
    await assertOk("Synthetic session visible via /api proxy too", async () => {
      const res = await fetch(`${web}/api/sessions/${synthSid}`);
      if (!res.ok) throw new Error(`proxy GET returned ${res.status}`);
      const body = await res.json();
      if (body.session?.id !== synthSid) {
        throw new Error(`proxy returned different id`);
      }
    });

    c.step("Shutting down…");
    child.kill("SIGINT");
    const code = await Promise.race([
      exited,
      new Promise((resolve) => setTimeout(() => resolve(null), 3000)),
    ]);
    if (code === null) {
      child.kill("SIGKILL");
      c.fail("child didn't exit within 3s of SIGINT (force-killed)");
    } else {
      c.ok(`child exited (code ${code})`);
    }

    exitCode = 0;
    c.ok("Smoke test passed.");
  } catch (err) {
    c.fail(err.stack ?? String(err));
    if (child) {
      try {
        child.kill("SIGKILL");
      } catch {
        // best-effort
      }
    }
  } finally {
    await fs.rm(scratch, { recursive: true, force: true }).catch(() => {});
    await fs.rm(tarballPath, { force: true }).catch(() => {});
  }

  process.exit(exitCode);
}

main();
