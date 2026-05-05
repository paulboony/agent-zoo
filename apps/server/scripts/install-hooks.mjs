#!/usr/bin/env node
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
const settingsPath = path.join(
  process.env.CLAUDE_HOME ?? path.join(os.homedir(), ".claude"),
  "settings.json",
);

async function main() {
  await fs.access(handlerPath).catch(() => {
    console.error(`hook-handler.mjs not found at ${handlerPath}`);
    process.exit(1);
  });

  let settings = {};
  try {
    const raw = await fs.readFile(settingsPath, "utf8");
    settings = JSON.parse(raw);
  } catch (err) {
    if (err.code !== "ENOENT") {
      console.error(`Cannot parse ${settingsPath}: ${err.message}`);
      console.error("Aborting; refusing to overwrite an unparseable settings.json.");
      process.exit(1);
    }
  }

  if (!settings.hooks || typeof settings.hooks !== "object") {
    settings.hooks = {};
  }

  const added = [];
  const updated = [];

  for (const event of EVENTS) {
    if (!Array.isArray(settings.hooks[event])) settings.hooks[event] = [];
    const arr = settings.hooks[event];

    const ownedBlock = arr.find(
      (block) =>
        Array.isArray(block?.hooks) &&
        block.hooks.some((h) => h?.owner === HOOK_OWNER),
    );

    if (!ownedBlock) {
      arr.push({
        matcher: "",
        hooks: [
          { type: "command", command: handlerPath, owner: HOOK_OWNER },
        ],
      });
      added.push(event);
    } else {
      const hook = ownedBlock.hooks.find((h) => h?.owner === HOOK_OWNER);
      if (hook && hook.command !== handlerPath) {
        hook.command = handlerPath;
        updated.push(event);
      }
    }
  }

  await atomicWrite(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);

  console.log(`Settings: ${settingsPath}`);
  console.log(`Handler:  ${handlerPath}`);
  if (added.length) console.log(`Added:    ${added.join(", ")}`);
  if (updated.length) console.log(`Updated:  ${updated.join(", ")}`);
  if (!added.length && !updated.length) console.log("No changes needed.");
}

async function atomicWrite(target, content) {
  const tmp = `${target}.tmp`;
  const fh = await fs.open(tmp, "w");
  try {
    await fh.writeFile(content);
    await fh.sync();
  } finally {
    await fh.close();
  }
  await fs.rename(tmp, target);
}

main().catch((err) => {
  console.error(err.stack ?? String(err));
  process.exit(1);
});
