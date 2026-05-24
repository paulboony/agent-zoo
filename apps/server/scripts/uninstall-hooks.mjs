#!/usr/bin/env node
/**
 * Remove every agent-zoo-owned entry from BOTH `~/.claude/settings.json`
 * and `~/.claude/settings.local.json`.
 *
 * We write to settings.local.json by default (see install-hooks.mjs),
 * but earlier versions of this tool wrote to settings.json — cleaning
 * both keeps a partial-migration user fully tidy.
 */
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { removeOwnedHooks } from "./hooks-edit.mjs";

const HOOK_OWNER = "claude-dashboard";

// Recognise legacy entries that lack the `owner` field — older
// versions of install-hooks didn't write it, so we'd otherwise leave
// them behind on uninstall. Same suffix list install-hooks uses.
const LEGACY_HANDLER_SUFFIXES = [
  "agent-zoo/apps/server/scripts/hook-handler.mjs",
  "agent-zoo/dist/scripts/hook-handler.mjs",
];

const claudeHome =
  process.env.CLAUDE_HOME ?? path.join(os.homedir(), ".claude");
const SHARED_PATH = path.join(claudeHome, "settings.json");
const LOCAL_PATH = path.join(claudeHome, "settings.local.json");

async function cleanFile(file) {
  let raw;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return { existed: false, removed: [] };
    throw new Error(`Cannot read ${file}: ${err.message}`);
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Cannot parse ${file}: ${err.message}`);
  }
  const { settings, removed } = removeOwnedHooks(data, {
    owner: HOOK_OWNER,
    handlerPathSuffix: LEGACY_HANDLER_SUFFIXES,
  });
  if (removed.length === 0) return { existed: true, removed: [] };
  await atomicWrite(file, `${JSON.stringify(settings, null, 2)}\n`);
  return { existed: true, removed };
}

async function main() {
  let anyRemoved = false;
  for (const file of [LOCAL_PATH, SHARED_PATH]) {
    let result;
    try {
      result = await cleanFile(file);
    } catch (err) {
      console.error(err.message);
      console.error(`Aborting; refusing to overwrite ${file}.`);
      process.exit(1);
    }
    if (!result.existed) {
      console.log(`No settings file at ${file}; skipping.`);
      continue;
    }
    if (result.removed.length === 0) {
      console.log(`No claude-dashboard entries in ${file}.`);
      continue;
    }
    anyRemoved = true;
    console.log(
      `Removed claude-dashboard entries from ${file}: ${result.removed.join(", ")}`,
    );
  }
  if (!anyRemoved) console.log("Nothing to do.");
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
