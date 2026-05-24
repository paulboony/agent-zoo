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

const HOOK_OWNER = "agent-zoo";
// Older versions of this tool used "claude-dashboard" as the owner
// marker. Any entry tagged with one of these in the user's settings
// gets migrated to the new owner during install — so we don't end up
// with duplicate blocks (one per name) firing for every hook.
const LEGACY_OWNERS = ["claude-dashboard"];
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

// Used to recognise legacy entries that lack the `owner` field. Any
// path ending in one of these suffixes is treated as ours during
// migration. Covers both dev installs (apps/server/scripts/...) and
// published bundle installs (dist/scripts/...) so long as they live
// under an `agent-zoo` directory.
const LEGACY_HANDLER_SUFFIXES = [
  "agent-zoo/apps/server/scripts/hook-handler.mjs",
  "agent-zoo/dist/scripts/hook-handler.mjs",
];

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

  const removeOpts = {
    owner: HOOK_OWNER,
    legacyOwners: LEGACY_OWNERS,
    handlerPathSuffix: LEGACY_HANDLER_SUFFIXES,
  };

  // 1. Clean settings.json (the shared file): strip any of our
  //    entries that linger there from pre-migration installs — by
  //    current owner, by legacy owner ("claude-dashboard"), or by
  //    handler path suffix. The dashboard's hooks belong in
  //    settings.local.json; anything in settings.json is a leftover.
  const sharedBefore = await readJson(SHARED_PATH);
  if (sharedBefore.exists) {
    const { settings: nextShared, removed } = removeOwnedHooks(
      sharedBefore.data,
      removeOpts,
    );
    if (removed.length > 0) {
      await atomicWrite(SHARED_PATH, `${JSON.stringify(nextShared, null, 2)}\n`);
      console.log(
        `Migrated: removed agent-zoo entries from settings.json (${removed.length} event(s)).`,
      );
    }
  }

  // 2. Refresh settings.local.json: strip any prior owned entries
  //    (catching old owner names) THEN add fresh blocks. This
  //    guarantees a clean rewrite — no duplicate blocks even if we
  //    rename the owner marker or move the handler path between
  //    releases.
  await fs.mkdir(claudeHome, { recursive: true });
  const localBefore = await readJson(LOCAL_PATH);
  const { settings: stripped, removed: legacyStripped } = removeOwnedHooks(
    localBefore.data,
    removeOpts,
  );
  const { settings: nextLocal, added, updated } = addOwnedHooks(stripped, {
    owner: HOOK_OWNER,
    handlerPath,
    events: EVENTS,
  });

  const fileChanged =
    legacyStripped.length > 0 || added.length > 0 || updated.length > 0;
  if (fileChanged) {
    await atomicWrite(LOCAL_PATH, `${JSON.stringify(nextLocal, null, 2)}\n`);
  }

  console.log(`Settings: ${LOCAL_PATH}`);
  console.log(`Handler:  ${handlerPath}`);
  if (!fileChanged) {
    console.log("No changes needed (settings.local.json already up to date).");
  } else {
    // We always strip-then-add, so post-rewrite every covered event
    // shows up in `added`. Surface a single summary line; details
    // about whether it was a rename vs a fresh install vs a path
    // refresh are inferable from the migration line printed above.
    console.log(`Installed: ${added.length} event(s) → owner "${HOOK_OWNER}"`);
  }
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
