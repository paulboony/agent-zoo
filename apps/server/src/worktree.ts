import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { SessionState } from "@agent-zoo/shared";
import { logger } from "./logger.js";
import { type Store, emit } from "./state.js";

const exec = promisify(execFile);
const GIT_TIMEOUT_MS = 2000;

export interface WorktreeInfo {
  is_worktree: boolean;
  /** Absolute path to the main checkout. Only set when is_worktree is true. */
  main_path?: string;
}

/**
 * Decide whether `cwd` is inside a git worktree (linked checkout) by
 * comparing `git rev-parse --git-dir` against `--git-common-dir`:
 *
 *   - For a regular checkout these are the same path (`.git`).
 *   - For a worktree the git-dir is `<main>/.git/worktrees/<name>`
 *     while the common-dir is `<main>/.git`.
 *
 * Returns `{ is_worktree: false }` for non-git directories, any subprocess
 * failure, or timeouts — detection is best-effort; missing info is
 * preferable to throwing on the session-create hot path.
 */
export async function detectWorktree(cwd: string): Promise<WorktreeInfo> {
  try {
    const [gitDirRes, commonDirRes] = await Promise.all([
      exec("git", ["-C", cwd, "rev-parse", "--git-dir"], { timeout: GIT_TIMEOUT_MS }),
      exec("git", ["-C", cwd, "rev-parse", "--git-common-dir"], { timeout: GIT_TIMEOUT_MS }),
    ]);
    const gitDir = gitDirRes.stdout.trim();
    const commonDir = commonDirRes.stdout.trim();
    if (!gitDir || !commonDir) return { is_worktree: false };
    // git may emit these as relative paths (resolved against the
    // working dir at exec time); resolve to absolute before comparing
    // and before deriving main_path.
    const absGitDir = path.resolve(cwd, gitDir);
    const absCommonDir = path.resolve(cwd, commonDir);
    if (absGitDir === absCommonDir) return { is_worktree: false };
    // The main checkout is the directory containing the common .git.
    return { is_worktree: true, main_path: path.dirname(absCommonDir) };
  } catch (err) {
    // Not a git repo, git binary missing, timeout — all best-effort.
    logger.debug({ err: String(err), cwd }, "worktree detection failed");
    return { is_worktree: false };
  }
}

/**
 * Commit a detected `WorktreeInfo` onto a session by rebuilding a fresh
 * SessionState, bumping seq, and broadcasting a session_upsert.
 * Mirrors the reducer's "build then commit" pattern so SSE subscribers
 * see either old or new state, never partial.
 *
 * Returns true when something was committed, false when the session is
 * gone or the info matches what's already on the session (idempotent —
 * safe to re-run after detection).
 */
export function applyWorktreeInfo(
  store: Store,
  sessionId: string,
  info: WorktreeInfo,
): boolean {
  const session = store.sessions.get(sessionId);
  if (!session) return false;
  const sameFlag = session.is_worktree === info.is_worktree;
  const sameMain = session.worktree_main_path === info.main_path;
  if (sameFlag && sameMain) return false;

  const next: SessionState = { ...session, is_worktree: info.is_worktree };
  if (info.main_path !== undefined) {
    next.worktree_main_path = info.main_path;
  } else if (session.worktree_main_path !== undefined) {
    // biome-ignore lint/performance/noDelete: required by exactOptionalPropertyTypes
    delete next.worktree_main_path;
  }
  store.sessions.set(sessionId, next);
  store.seq += 1;
  emit(store, { type: "session_upsert", seq: store.seq, session: next });
  return true;
}
