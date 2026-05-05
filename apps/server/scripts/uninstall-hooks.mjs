#!/usr/bin/env node
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const HOOK_OWNER = "claude-dashboard";
const settingsPath = path.join(
  process.env.CLAUDE_HOME ?? path.join(os.homedir(), ".claude"),
  "settings.json",
);

async function main() {
  let settings;
  try {
    const raw = await fs.readFile(settingsPath, "utf8");
    settings = JSON.parse(raw);
  } catch (err) {
    if (err.code === "ENOENT") {
      console.log(`No settings file at ${settingsPath}; nothing to do.`);
      return;
    }
    console.error(`Cannot parse ${settingsPath}: ${err.message}`);
    process.exit(1);
  }

  if (!settings.hooks || typeof settings.hooks !== "object") {
    console.log("No hooks installed; nothing to do.");
    return;
  }

  const removed = [];

  for (const event of Object.keys(settings.hooks)) {
    const arr = settings.hooks[event];
    if (!Array.isArray(arr)) continue;

    const filtered = [];
    for (const block of arr) {
      if (!Array.isArray(block?.hooks)) {
        filtered.push(block);
        continue;
      }
      const remainingHooks = block.hooks.filter(
        (h) => h?.owner !== HOOK_OWNER,
      );
      const removedCount = block.hooks.length - remainingHooks.length;
      if (removedCount > 0 && !removed.includes(event)) removed.push(event);
      if (remainingHooks.length === 0) continue;
      filtered.push({ ...block, hooks: remainingHooks });
    }

    if (filtered.length === 0) {
      delete settings.hooks[event];
    } else {
      settings.hooks[event] = filtered;
    }
  }

  if (Object.keys(settings.hooks).length === 0) delete settings.hooks;

  await atomicWrite(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);

  if (removed.length === 0) {
    console.log("No claude-dashboard entries found; nothing changed.");
  } else {
    console.log(`Removed claude-dashboard entries from: ${removed.join(", ")}`);
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
