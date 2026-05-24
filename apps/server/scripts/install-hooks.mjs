#!/usr/bin/env node
/**
 * Wire agent-zoo's hook handler into Claude Code's settings.
 *
 * Target file is `~/.claude/settings.local.json` (per-machine local
 * override file) — keeps our auto-installed entries out of the
 * shared `settings.json` that users hand-edit / version-control.
 *
 * Migration: every invocation also checks `settings.json` for any
 * entries owned by us from older versions of this tool and removes
 * them, so users mid-upgrade end up with hooks in exactly one place.
 */
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { addOwnedHooks, removeOwnedHooks } from "./hooks-edit.mjs";

const HOOK_OWNER = "claude-dashboard";
const EVENTS = [
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
const claudeHome =
  process.env.CLAUDE_HOME ?? path.join(os.homedir(), ".claude");
const SHARED_PATH = path.join(claudeHome, "settings.json");
const LOCAL_PATH = path.join(claudeHome, "settings.local.json");

async function readJson(file) {
  try {
    const raw = await fs.readFile(file, "utf8");
    return { exists: true, data: JSON.parse(raw) };
  } catch (err) {
    if (err.code === "ENOENT") return { exists: false, data: {} };
    throw new Error(`Cannot parse ${file}: ${err.message}`);
  }
}

async function main() {
  await fs.access(handlerPath).catch(() => {
    console.error(`hook-handler.mjs not found at ${handlerPath}`);
    process.exit(1);
  });

  // 1. Migrate: if any of our entries linger in the shared file from
  //    pre-migration installs, strip them. This is a one-shot per
  //    machine — once stripped, subsequent runs find nothing to do.
  const sharedBefore = await readJson(SHARED_PATH);
  if (sharedBefore.exists) {
    const { settings: nextShared, removed } = removeOwnedHooks(
      sharedBefore.data,
      { owner: HOOK_OWNER },
    );
    if (removed.length > 0) {
      await atomicWrite(SHARED_PATH, `${JSON.stringify(nextShared, null, 2)}\n`);
      console.log(
        `Migrated: removed claude-dashboard entries from settings.json (${removed.length} event(s)).`,
      );
    }
  }

  // 2. Install: write/refresh our entries in settings.local.json.
  await fs.mkdir(claudeHome, { recursive: true });
  const localBefore = await readJson(LOCAL_PATH);
  const { settings: nextLocal, added, updated } = addOwnedHooks(
    localBefore.data,
    { owner: HOOK_OWNER, handlerPath, events: EVENTS },
  );

  if (added.length === 0 && updated.length === 0) {
    console.log("No changes needed (settings.local.json already up to date).");
  } else {
    await atomicWrite(LOCAL_PATH, `${JSON.stringify(nextLocal, null, 2)}\n`);
  }

  console.log(`Settings: ${LOCAL_PATH}`);
  console.log(`Handler:  ${handlerPath}`);
  if (added.length) console.log(`Added:    ${added.join(", ")}`);
  if (updated.length) console.log(`Updated:  ${updated.join(", ")}`);
}

async function atomicWrite(target, content) {
  const resolved = await fs.realpath(target).catch(() => target);
  const mode = await fs
    .stat(resolved)
    .then((s) => s.mode)
    .catch(() => null);
  const tmp = `${resolved}.tmp.${process.pid}.${Date.now()}`;
  const fh = await fs.open(tmp, "w");
  try {
    await fh.writeFile(content);
    await fh.sync();
  } finally {
    await fh.close();
  }
  if (mode !== null) await fs.chmod(tmp, mode);
  try {
    await fs.rename(tmp, resolved);
  } catch (err) {
    await fs.unlink(tmp).catch(() => {});
    throw err;
  }
}

main().catch((err) => {
  console.error(err.stack ?? String(err));
  process.exit(1);
});
