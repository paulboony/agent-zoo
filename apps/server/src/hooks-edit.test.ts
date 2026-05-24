import { describe, expect, it } from "vitest";
// @ts-expect-error - .mjs sibling under scripts/, no type declarations.
import { addOwnedHooks, removeOwnedHooks } from "../scripts/hooks-edit.mjs";

const OWNER = "claude-dashboard";
const HANDLER = "/abs/path/to/hook-handler.mjs";
const EVENTS = ["SessionStart", "Stop", "PreToolUse"];

const opts = () => ({ owner: OWNER, handlerPath: HANDLER, events: EVENTS });

describe("addOwnedHooks", () => {
  it("seeds every event in an empty settings object", () => {
    const { settings, added, updated } = addOwnedHooks({}, opts());
    expect(added.sort()).toEqual([...EVENTS].sort());
    expect(updated).toEqual([]);
    for (const ev of EVENTS) {
      const arr = settings.hooks[ev];
      expect(arr).toHaveLength(1);
      expect(arr[0].hooks[0]).toMatchObject({ command: HANDLER, owner: OWNER });
    }
  });

  it("is idempotent — re-running on already-installed settings reports no changes", () => {
    const first = addOwnedHooks({}, opts()).settings;
    const second = addOwnedHooks(first, opts());
    expect(second.added).toEqual([]);
    expect(second.updated).toEqual([]);
    // Hook arrays didn't grow.
    for (const ev of EVENTS) expect(second.settings.hooks[ev]).toHaveLength(1);
  });

  it("updates the command when the handler path moves", () => {
    const first = addOwnedHooks({}, opts()).settings;
    const result = addOwnedHooks(first, {
      ...opts(),
      handlerPath: "/new/path/handler.mjs",
    });
    expect(result.added).toEqual([]);
    expect(result.updated.sort()).toEqual([...EVENTS].sort());
    for (const ev of EVENTS) {
      const owned = result.settings.hooks[ev][0].hooks.find(
        (h: { owner?: string }) => h.owner === OWNER,
      );
      expect(owned.command).toBe("/new/path/handler.mjs");
    }
  });

  it("co-exists with other tools' hooks at the same event", () => {
    const existing = {
      hooks: {
        Stop: [
          {
            matcher: "*",
            hooks: [{ type: "command", command: "/some/other-tool" }],
          },
        ],
      },
    };
    const { settings, added } = addOwnedHooks(existing, opts());
    expect(added).toContain("Stop");
    // Existing block preserved as-is.
    expect(settings.hooks.Stop[0].hooks[0].command).toBe("/some/other-tool");
    // Our block appended.
    const ours = settings.hooks.Stop.find((b: { hooks: { owner?: string }[] }) =>
      b.hooks.some((h) => h.owner === OWNER),
    );
    expect(ours).toBeDefined();
  });

  it("never mutates the input settings object", () => {
    const before = {
      hooks: { Stop: [{ matcher: "*", hooks: [{ command: "/x" }] }] },
    };
    const snapshot = JSON.parse(JSON.stringify(before));
    addOwnedHooks(before, opts());
    expect(before).toEqual(snapshot);
  });
});

describe("removeOwnedHooks", () => {
  it("returns no-op on empty settings", () => {
    const { settings, removed } = removeOwnedHooks({}, { owner: OWNER });
    expect(removed).toEqual([]);
    expect(settings).toEqual({});
  });

  it("strips every owned entry, leaves nothing behind", () => {
    const installed = addOwnedHooks({}, opts()).settings;
    const { settings, removed } = removeOwnedHooks(installed, { owner: OWNER });
    expect(removed.sort()).toEqual([...EVENTS].sort());
    expect(settings.hooks).toBeUndefined();
  });

  it("preserves other tools' hooks at the same event", () => {
    const start = {
      hooks: {
        Stop: [
          {
            matcher: "*",
            hooks: [{ type: "command", command: "/other-tool" }],
          },
          {
            matcher: "",
            hooks: [{ type: "command", command: HANDLER, owner: OWNER }],
          },
        ],
      },
    };
    const { settings, removed } = removeOwnedHooks(start, { owner: OWNER });
    expect(removed).toEqual(["Stop"]);
    expect(settings.hooks.Stop).toHaveLength(1);
    expect(settings.hooks.Stop[0].hooks[0].command).toBe("/other-tool");
  });

  it("never mutates the input settings object", () => {
    const installed = addOwnedHooks({}, opts()).settings;
    const snapshot = JSON.parse(JSON.stringify(installed));
    removeOwnedHooks(installed, { owner: OWNER });
    expect(installed).toEqual(snapshot);
  });
});
