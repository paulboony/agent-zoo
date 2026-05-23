import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { SessionState, SseMessage } from "@agent-zoo/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createStore } from "./state.js";
import { applyWorktreeInfo, detectWorktree } from "./worktree.js";

const exec = promisify(execFile);

async function gitInit(dir: string): Promise<void> {
  await exec("git", ["-C", dir, "init", "-q", "-b", "main"]);
  await fs.writeFile(path.join(dir, "f.txt"), "hello");
  await exec("git", ["-C", dir, "add", "."]);
  await exec("git", [
    "-C",
    dir,
    "-c",
    "user.email=t@t",
    "-c",
    "user.name=t",
    "commit",
    "-qm",
    "init",
  ]);
}

describe("detectWorktree", () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-zoo-wt-"));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("returns is_worktree:false for a non-git directory", async () => {
    const r = await detectWorktree(root);
    expect(r).toEqual({ is_worktree: false });
  });

  it("returns is_worktree:false for a regular git checkout", async () => {
    const main = path.join(root, "main");
    await fs.mkdir(main);
    await gitInit(main);
    const r = await detectWorktree(main);
    expect(r).toEqual({ is_worktree: false });
  });

  it("returns is_worktree:true with main_path for a linked worktree", async () => {
    const main = path.join(root, "main");
    await fs.mkdir(main);
    await gitInit(main);
    const wt = path.join(root, "wt");
    await exec("git", ["-C", main, "worktree", "add", "-q", wt]);

    const r = await detectWorktree(wt);
    expect(r.is_worktree).toBe(true);
    // realpath the expected & received paths so macOS /private/var
    // vs /var doesn't trip the comparison.
    const expected = await fs.realpath(main);
    const got = r.main_path ? await fs.realpath(r.main_path) : "";
    expect(got).toBe(expected);
  });

  it("detects a worktree even when cwd is a subdirectory of the worktree", async () => {
    const main = path.join(root, "main");
    await fs.mkdir(main);
    await gitInit(main);
    const wt = path.join(root, "wt");
    await exec("git", ["-C", main, "worktree", "add", "-q", wt]);
    const sub = path.join(wt, "subdir");
    await fs.mkdir(sub);

    const r = await detectWorktree(sub);
    expect(r.is_worktree).toBe(true);
  });
});

function seedSession(): { store: ReturnType<typeof createStore>; sid: string } {
  const store = createStore();
  const sid = "s-wt";
  store.sessions.set(sid, {
    id: sid,
    cwd: "/tmp",
    cwd_basename: "tmp",
    started_at: "2026-05-15T10:00:00.000Z",
    last_event_at: "2026-05-15T10:00:00.000Z",
    status: "running",
    agents: {},
  });
  return { store, sid };
}

describe("applyWorktreeInfo", () => {
  it("commits a fresh SessionState and broadcasts an upsert when info changes", () => {
    const { store, sid } = seedSession();
    const prev = store.sessions.get(sid);
    const seqBefore = store.seq;
    const upserts: SseMessage[] = [];
    store.subscribers.add((m) => upserts.push(m));

    const committed = applyWorktreeInfo(store, sid, {
      is_worktree: true,
      main_path: "/abs/main",
    });

    expect(committed).toBe(true);
    const next = store.sessions.get(sid);
    expect(next?.is_worktree).toBe(true);
    expect(next?.worktree_main_path).toBe("/abs/main");
    // Fresh object (invariant: committed SessionStates are immutable)
    expect(next).not.toBe(prev);
    expect(store.seq).toBe(seqBefore + 1);
    expect(upserts).toHaveLength(1);
    expect(upserts[0]?.type).toBe("session_upsert");
  });

  it("is idempotent — re-applying the same info doesn't emit", () => {
    const { store, sid } = seedSession();
    applyWorktreeInfo(store, sid, { is_worktree: true, main_path: "/abs/main" });
    const seqAfterFirst = store.seq;
    const upserts: SseMessage[] = [];
    store.subscribers.add((m) => upserts.push(m));

    const committed = applyWorktreeInfo(store, sid, {
      is_worktree: true,
      main_path: "/abs/main",
    });

    expect(committed).toBe(false);
    expect(store.seq).toBe(seqAfterFirst);
    expect(upserts).toHaveLength(0);
  });

  it("returns false when the session no longer exists", () => {
    const store = createStore();
    const committed = applyWorktreeInfo(store, "missing", { is_worktree: true });
    expect(committed).toBe(false);
  });

  it("clears a stale worktree_main_path when info downgrades to is_worktree:false", () => {
    const { store, sid } = seedSession();
    applyWorktreeInfo(store, sid, { is_worktree: true, main_path: "/abs/main" });
    applyWorktreeInfo(store, sid, { is_worktree: false });
    const session = store.sessions.get(sid);
    expect(session?.is_worktree).toBe(false);
    expect(session?.worktree_main_path).toBeUndefined();
    expect("worktree_main_path" in (session as SessionState)).toBe(false);
  });
});
