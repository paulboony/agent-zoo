#!/usr/bin/env node
/**
 * Build the publishable artifact under `dist/`. Run by
 * `npm run build:dist` (and `prepublishOnly`).
 *
 * Layout produced:
 *   dist/
 *     server.mjs              — esbuild-bundled API server
 *     web/                    — vite-built SPA (copy of apps/web/dist/)
 *     scripts/
 *       hook-handler.mjs      — runtime hook entrypoint (CC spawns it)
 *       post-with-retry.mjs     — retry helper imported by hook-handler
 *       install-hooks.mjs     — wires ~/.claude/settings.json
 *       uninstall-hooks.mjs   — removes our entries
 *
 * Everything bin/agent-zoo.mjs needs is rooted under dist/, so the
 * published tarball just ships bin/ + dist/ + package.json + README.
 */
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");

const step = (msg) => process.stdout.write(`\x1b[36m▸\x1b[0m ${msg}\n`);
const ok = (msg) => process.stdout.write(`\x1b[32m✓\x1b[0m ${msg}\n`);

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "inherit", cwd: ROOT, ...opts });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(" ")} exited ${code}`));
    });
    child.on("error", reject);
  });
}

async function copyDir(src, dst) {
  await fs.cp(src, dst, { recursive: true, force: true });
}

async function copyFile(src, dst) {
  await fs.mkdir(path.dirname(dst), { recursive: true });
  await fs.copyFile(src, dst);
}

async function main() {
  step("Cleaning dist/");
  await fs.rm(DIST, { recursive: true, force: true });
  await fs.mkdir(DIST, { recursive: true });

  step("Building web (vite)");
  await run("pnpm", ["--filter", "@agent-zoo/web", "build"]);

  step("Bundling server (esbuild)");
  await run("pnpm", [
    "exec",
    "esbuild",
    "apps/server/src/index.ts",
    "--bundle",
    "--format=esm",
    "--platform=node",
    "--target=node20",
    `--outfile=${path.join(DIST, "server.mjs")}`,
    "--banner:js=import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
  ]);

  step("Copying web dist → dist/web/");
  await copyDir(path.join(ROOT, "apps/web/dist"), path.join(DIST, "web"));

  step("Copying scripts → dist/scripts/");
  const scriptSrcs = [
    "hook-handler.mjs",
    "post-with-retry.mjs",
    "install-hooks.mjs",
    "uninstall-hooks.mjs",
  ];
  for (const name of scriptSrcs) {
    await copyFile(
      path.join(ROOT, "apps/server/scripts", name),
      path.join(DIST, "scripts", name),
    );
  }
  // The handler shebang needs execute perms preserved after copy.
  await fs.chmod(path.join(DIST, "scripts", "hook-handler.mjs"), 0o755);

  ok("Build complete.");
  step("Artifact layout:");
  const tree = await collectTree(DIST);
  for (const line of tree) process.stdout.write(`  ${line}\n`);
}

async function collectTree(dir, prefix = "") {
  const out = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      out.push(`${prefix}${e.name}/`);
      const sub = await collectTree(full, `${prefix}  `);
      out.push(...sub);
    } else {
      const stat = await fs.stat(full);
      const kb = (stat.size / 1024).toFixed(1);
      out.push(`${prefix}${e.name}  (${kb} KB)`);
    }
  }
  return out;
}

main().catch((err) => {
  process.stderr.write(`\x1b[31m✗\x1b[0m ${err.stack ?? String(err)}\n`);
  process.exit(1);
});
