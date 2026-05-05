#!/usr/bin/env node
import { promises as fs } from "node:fs";
import { createConnection } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HOOK_OWNER = "claude-dashboard";
const REQUIRED_EVENTS = [
  "SessionStart",
  "SessionEnd",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "SubagentStart",
  "SubagentStop",
  "Notification",
  "Stop",
  "PermissionRequest",
  "Elicitation",
  "StopFailure",
];

const here = path.dirname(fileURLToPath(import.meta.url));
const handlerPath = path.resolve(here, "hook-handler.mjs");
const claudeHome = process.env.CLAUDE_HOME ?? path.join(os.homedir(), ".claude");
const settingsPath = path.join(claudeHome, "settings.json");
const projectsDir = path.join(claudeHome, "projects");

let exitCode = 0;
const ok = (msg) => console.log(`✓ ${msg}`);
const warn = (msg) => console.log(`⚠ ${msg}`);
const fail = (msg) => {
  console.log(`✗ ${msg}`);
  exitCode = 1;
};

async function main() {
  // 1. Node version
  const major = Number(process.versions.node.split(".")[0]);
  if (major >= 20) ok(`Node ${process.versions.node}`);
  else fail(`Node ${process.versions.node} (need >= 20)`);

  // 2. ~/.claude exists
  let claudeHomeOk = false;
  try {
    const stat = await fs.stat(claudeHome);
    if (stat.isDirectory()) {
      ok(`${claudeHome} exists`);
      claudeHomeOk = true;
    } else {
      fail(`${claudeHome} is not a directory`);
    }
  } catch {
    fail(`${claudeHome} not found`);
  }

  // 3. settings.json valid JSON
  let settings = null;
  if (claudeHomeOk) {
    try {
      settings = JSON.parse(await fs.readFile(settingsPath, "utf8"));
      ok(`${settingsPath} parses`);
    } catch (err) {
      fail(`${settingsPath} not parseable: ${err.message}`);
    }
  }

  // 4. Dashboard hooks installed
  if (settings?.hooks) {
    const missing = [];
    for (const event of REQUIRED_EVENTS) {
      const arr = settings.hooks[event];
      const present =
        Array.isArray(arr) &&
        arr.some(
          (block) =>
            Array.isArray(block?.hooks) &&
            block.hooks.some((h) => h?.owner === HOOK_OWNER),
        );
      if (!present) missing.push(event);
    }
    if (missing.length === 0) ok("all required dashboard hooks installed");
    else fail(`missing dashboard hooks: ${missing.join(", ")}`);
  } else if (settings) {
    fail("settings.json has no hooks key; run pnpm install-hooks");
  }

  // 5. handler readable
  try {
    await fs.access(handlerPath, fs.constants.R_OK);
    ok(`hook-handler.mjs readable at ${handlerPath}`);
  } catch {
    fail(`hook-handler.mjs not readable at ${handlerPath}`);
  }

  // 6. handler path matches settings
  if (settings?.hooks) {
    const mismatches = [];
    for (const event of REQUIRED_EVENTS) {
      const arr = settings.hooks[event];
      if (!Array.isArray(arr)) continue;
      for (const block of arr) {
        if (!Array.isArray(block?.hooks)) continue;
        for (const h of block.hooks) {
          if (h?.owner === HOOK_OWNER && h.command !== handlerPath) {
            mismatches.push(`${event}: ${h.command}`);
          }
        }
      }
    }
    if (mismatches.length === 0) {
      ok("hook handler paths match current repo");
    } else {
      fail(`hook handler path mismatches:`);
      for (const m of mismatches) console.log(`    - ${m}`);
    }
  }

  // 7. Foreign hook entries (warn-only)
  if (settings?.hooks) {
    const foreign = [];
    for (const event of Object.keys(settings.hooks)) {
      const arr = settings.hooks[event];
      if (!Array.isArray(arr)) continue;
      for (const block of arr) {
        if (!Array.isArray(block?.hooks)) continue;
        for (const h of block.hooks) {
          if (h?.owner !== HOOK_OWNER && h?.command) {
            foreign.push(`${event}: ${h.command}`);
          }
        }
      }
    }
    if (foreign.length === 0) {
      ok("no foreign hook entries");
    } else {
      warn(`foreign hook entries (left untouched):`);
      for (const line of foreign) console.log(`    - ${line}`);
    }
  }

  // 8. Server port free or ours
  const portStatus = await probePort("127.0.0.1", 7777);
  if (portStatus === "free") ok("port 7777 free");
  else if (portStatus === "ours") ok("port 7777 in use by agent-zoo (running)");
  else fail("port 7777 in use by another process");

  // 9. ~/.claude/projects has data
  try {
    const entries = await fs.readdir(projectsDir);
    if (entries.length > 0) ok(`${projectsDir} has ${entries.length} entries`);
    else warn(`${projectsDir} empty`);
  } catch {
    warn(`${projectsDir} not present`);
  }

  process.exit(exitCode);
}

async function probePort(host, port) {
  const status = await new Promise((resolve) => {
    const sock = createConnection({ host, port, timeout: 200 }, () => {
      sock.end();
      resolve("inuse");
    });
    sock.on("error", () => resolve("free"));
    sock.on("timeout", () => {
      sock.destroy();
      resolve("free");
    });
  });

  if (status === "free") return "free";

  try {
    const res = await fetch(`http://${host}:${port}/healthz`, {
      signal: AbortSignal.timeout(500),
    });
    const body = await res.json().catch(() => null);
    return body?.ok === true ? "ours" : "other";
  } catch {
    return "other";
  }
}

main().catch((err) => {
  console.error(err.stack ?? String(err));
  process.exit(1);
});
