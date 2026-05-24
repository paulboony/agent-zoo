/**
 * Pure (no I/O) helpers for editing a Claude Code settings JSON object.
 *
 * The functions take a settings object in and return a new settings
 * object + a change summary; they never mutate the input. Callers
 * handle reading/writing the file.
 *
 * Why this lives in its own module: install-hooks.mjs and
 * uninstall-hooks.mjs both edit the same shape, plus the migration
 * path needs to operate on the same in-memory model. Keeping the
 * core logic pure also makes it trivial to vitest.
 */

const DEFAULT_MATCHER = "";

function deepClone(value) {
  return JSON.parse(JSON.stringify(value ?? {}));
}

function findOwnedBlock(arr, owner) {
  if (!Array.isArray(arr)) return undefined;
  return arr.find(
    (block) =>
      Array.isArray(block?.hooks) && block.hooks.some((h) => h?.owner === owner),
  );
}

/**
 * Add or refresh hook entries for `events`, all owned by `owner`,
 * pointing at `handlerPath`.
 *
 * Returns `{ settings, added, updated }`:
 *   - `settings` is a new object; the input is never mutated.
 *   - `added` is the list of events where no owned block existed
 *     before (we inserted one).
 *   - `updated` is the list where an owned block existed but its
 *     command path differed and we rewrote it.
 *
 * Other tools' hook blocks at the same event are preserved untouched.
 */
export function addOwnedHooks(input, opts) {
  const { owner, handlerPath, events } = opts;
  if (!owner || !handlerPath || !Array.isArray(events)) {
    throw new TypeError("addOwnedHooks: owner, handlerPath, events required");
  }
  const settings = deepClone(input);
  if (!settings.hooks || typeof settings.hooks !== "object") {
    settings.hooks = {};
  }
  const added = [];
  const updated = [];
  for (const event of events) {
    if (!Array.isArray(settings.hooks[event])) settings.hooks[event] = [];
    const arr = settings.hooks[event];
    const ownedBlock = findOwnedBlock(arr, owner);
    if (!ownedBlock) {
      arr.push({
        matcher: DEFAULT_MATCHER,
        hooks: [{ type: "command", command: handlerPath, owner }],
      });
      added.push(event);
      continue;
    }
    const hook = ownedBlock.hooks.find((h) => h?.owner === owner);
    if (hook && hook.command !== handlerPath) {
      hook.command = handlerPath;
      updated.push(event);
    }
  }
  return { settings, added, updated };
}

/**
 * Remove every hook entry whose `owner === opts.owner` from the
 * settings object. Returns `{ settings, removed }`:
 *   - `settings` is a new object; the input is never mutated.
 *   - `removed` is the list of events where at least one owned entry
 *     was stripped. Hook arrays that go empty are deleted; if no
 *     events remain, the whole `hooks` key is removed.
 *
 * Other tools' hook blocks at the same event are preserved untouched.
 */
export function removeOwnedHooks(input, opts) {
  const { owner } = opts;
  if (!owner) throw new TypeError("removeOwnedHooks: owner required");
  const settings = deepClone(input);
  if (!settings.hooks || typeof settings.hooks !== "object") {
    return { settings, removed: [] };
  }
  const removed = [];
  for (const event of Object.keys(settings.hooks)) {
    const arr = settings.hooks[event];
    if (!Array.isArray(arr)) continue;
    const filtered = [];
    let strippedFromThisEvent = false;
    for (const block of arr) {
      if (!Array.isArray(block?.hooks)) {
        filtered.push(block);
        continue;
      }
      const remainingHooks = block.hooks.filter((h) => h?.owner !== owner);
      if (remainingHooks.length !== block.hooks.length) {
        strippedFromThisEvent = true;
      }
      if (remainingHooks.length > 0) {
        filtered.push({ ...block, hooks: remainingHooks });
      }
    }
    if (strippedFromThisEvent) removed.push(event);
    if (filtered.length === 0) {
      delete settings.hooks[event];
    } else {
      settings.hooks[event] = filtered;
    }
  }
  if (Object.keys(settings.hooks).length === 0) {
    delete settings.hooks;
  }
  return { settings, removed };
}
