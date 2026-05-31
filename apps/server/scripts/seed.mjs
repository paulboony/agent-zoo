#!/usr/bin/env node
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const ENDPOINT = process.env.CLAUDE_DASHBOARD_URL ?? "http://127.0.0.1:7777/hook";
const API_BASE = ENDPOINT.replace(/\/hook\/?$/, "/api");

const args = process.argv.slice(2);
let scenario = "demo";
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--scenario" && args[i + 1]) {
    scenario = args[i + 1];
    i += 1;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function post(payload) {
  const body = JSON.stringify({
    received_at: new Date().toISOString(),
    payload,
  });
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
  if (!res.ok) {
    throw new Error(`POST ${ENDPOINT} returned ${res.status}`);
  }
}

const ALPHA_CWD = "/Users/demo/projects/alpha";
const ALPHA_TX = "/Users/demo/.claude/projects/alpha.jsonl";
const BETA_CWD = "/Users/demo/projects/beta";
const BETA_TX = "/Users/demo/.claude/projects/beta.jsonl";

/**
 * Dispatches a sub-agent the way superpowers actually does it:
 * a parent PreToolUse for the Task tool whose tool_input.description
 * carries the human-readable label, then a SubagentStart whose
 * agent_id matches the parent's tool_use_id.
 *
 * The reducer correlates the two via tool_use_id and sets agent.label,
 * which the UI then maps to a mascot kind via the label rule table.
 */
async function spawnSubagent({ id, description, prompt, subagent_type = "general-purpose" }) {
  await post({
    hook_event_name: "PreToolUse",
    session_id: "seed-alpha",
    cwd: ALPHA_CWD,
    transcript_path: ALPHA_TX,
    tool_name: "Task",
    tool_input: { description, subagent_type, prompt: prompt ?? description },
    tool_use_id: id,
  });
  await post({
    hook_event_name: "SubagentStart",
    session_id: "seed-alpha",
    cwd: ALPHA_CWD,
    transcript_path: ALPHA_TX,
    agent_id: id,
    agent_type: subagent_type,
    agent_transcript_path: `/Users/demo/.claude/projects/${id}.jsonl`,
  });
}

/**
 * Create an isolated git main checkout + linked worktree under
 * `os.tmpdir()`, return the absolute worktree path. The server's
 * `detectWorktree` runs `git rev-parse --git-dir/--git-common-dir`
 * against the cwd, so the path must be a real git worktree at the
 * time the SessionStart hook fires.
 */
async function createSeedWorktree() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-zoo-seed-wt-"));
  const main = path.join(root, "main");
  const wt = path.join(root, "wt");
  await fs.mkdir(main);
  await exec("git", ["-C", main, "init", "-q", "-b", "main"]);
  await fs.writeFile(path.join(main, "README"), "seed\n");
  await exec("git", ["-C", main, "add", "."]);
  await exec("git", [
    "-C",
    main,
    "-c",
    "user.email=seed@agent-zoo",
    "-c",
    "user.name=seed",
    "commit",
    "-qm",
    "init",
  ]);
  await exec("git", ["-C", main, "worktree", "add", "-q", wt]);
  return wt;
}

/**
 * Poll the snapshot endpoint until `is_worktree` is no longer
 * undefined for the given session. detectWorktree is fire-and-forget
 * after SessionStart, so the seed waits for it to settle before
 * returning — keeps the e2e deterministic.
 */
async function waitForWorktreeDetection(sessionId, { timeoutMs = 5000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${API_BASE}/sessions/${sessionId}`);
      if (res.ok) {
        const body = await res.json();
        if (body?.session?.is_worktree !== undefined) return;
      }
    } catch {
      // server briefly unavailable — keep polling
    }
    await sleep(50);
  }
  console.warn(`seed: is_worktree detection did not settle for ${sessionId}`);
}

async function demo() {
  // Two sessions starting in parallel
  await post({
    hook_event_name: "SessionStart",
    session_id: "seed-alpha",
    cwd: ALPHA_CWD,
    transcript_path: ALPHA_TX,
    source: "startup",
  });
  await post({
    hook_event_name: "SessionStart",
    session_id: "seed-beta",
    cwd: BETA_CWD,
    transcript_path: BETA_TX,
    source: "startup",
  });

  // Alpha receives a user prompt to display a goal line
  await post({
    hook_event_name: "UserPromptSubmit",
    session_id: "seed-alpha",
    cwd: ALPHA_CWD,
    transcript_path: ALPHA_TX,
    prompt: "Add a goal line so I know what each main agent is working on",
  });

  // Alpha kicks off a Bash command
  await post({
    hook_event_name: "PreToolUse",
    session_id: "seed-alpha",
    cwd: ALPHA_CWD,
    transcript_path: ALPHA_TX,
    tool_name: "Bash",
    tool_input: { command: "pnpm test" },
    tool_use_id: "alpha-bash-1",
  });

  // Alpha spawns five sub-agents — one per label-rule mascot kind, all
  // dispatched as `general-purpose` (matches real superpowers usage).
  // Two are reviewers: one ends quickly (test "Show ended" toggle), the
  // other stays active so the reviewer mascot is visible by default.
  await spawnSubagent({
    id: "alpha-reviewer-1",
    description: "Final review of feature",
    prompt:
      "Do a final review of the feature branch `feat/notifications`. Check the diff against master for unused exports, missing aria labels on the new toggle, and whether the localStorage keys match the spec. Flag anything that should block merge.",
  });
  await spawnSubagent({
    id: "alpha-reviewer-2",
    description: "Spec review for notification settings",
    prompt:
      "Read docs/specs/notifications-settings.md and audit it against the current implementation in notifications-section.tsx and use-notifications.ts. List any drift between spec and code, and call out any behaviours that the spec doesn't cover (focus suppression, requireInteraction, edge-triggering).",
  });
  await spawnSubagent({
    id: "alpha-explorer-1",
    description: "Explore the codebase",
    prompt:
      "Investigate how the notification preferences are persisted across the codebase. Look at use-notifications.ts, notifications-section.tsx, and the underlying localStorage keys. Report which keys are read and written, and whether the master toggle gates per-event prefs.",
  });
  await spawnSubagent({
    id: "alpha-coder-1",
    description: "Implement Task 5",
    prompt:
      "Implement the subagent_spawn notification event end-to-end: extend the prefs map, add the dispatch path in use-notifications.ts, wire the toggle in notifications-section.tsx, and update the e2e test.",
  });
  await spawnSubagent({
    id: "alpha-writer-1",
    description: "Write notification spec",
    prompt:
      "Draft a spec for the notifications settings page. Cover master toggle, per-event switches, focus suppression, and the requireInteraction policy for blocked and session_error.",
  });

  // Beta hits a permission prompt
  await post({
    hook_event_name: "PermissionRequest",
    session_id: "seed-beta",
    cwd: BETA_CWD,
    transcript_path: BETA_TX,
    message: "Allow Write to /etc/hosts?",
    title: "Permission needed",
  });

  // Reviewer sub-agent finishes (so the "Show ended" toggle has something
  // to reveal). The other three stay active.
  await post({
    hook_event_name: "SubagentStop",
    session_id: "seed-alpha",
    cwd: ALPHA_CWD,
    transcript_path: ALPHA_TX,
    agent_id: "alpha-reviewer-1",
    agent_type: "general-purpose",
    agent_transcript_path: "/Users/demo/.claude/projects/alpha-reviewer-1.jsonl",
  });

  await post({
    hook_event_name: "PostToolUse",
    session_id: "seed-alpha",
    cwd: ALPHA_CWD,
    transcript_path: ALPHA_TX,
    tool_name: "Bash",
    tool_input: { command: "pnpm test" },
    tool_use_id: "alpha-bash-1",
  });

  // Gamma: running inside a real linked git worktree. Exercises the
  // server's worktree detection + the UI's WorktreeBadge.
  const worktreePath = await createSeedWorktree();
  await post({
    hook_event_name: "SessionStart",
    session_id: "seed-gamma",
    cwd: worktreePath,
    transcript_path: `${worktreePath}/.claude/transcript.jsonl`,
    source: "startup",
  });
  // Detection is fire-and-forget post-SessionStart; wait for the
  // follow-up upsert so the field is settled before the e2e queries.
  await waitForWorktreeDetection("seed-gamma");

  await seedActivity();

  console.log("seed: demo scenario complete");
}

/** Post an activity event for the alpha session at an explicit time. */
async function postActivityAt(hook_event_name, received_at, extra = {}) {
  const body = JSON.stringify({
    received_at,
    payload: {
      hook_event_name,
      session_id: "seed-alpha",
      cwd: ALPHA_CWD,
      transcript_path: ALPHA_TX,
      ...extra,
    },
  });
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
  if (!res.ok) throw new Error(`POST ${ENDPOINT} returned ${res.status}`);
}

/**
 * Spread tool-call / error events across the last several hours so the
 * 24h activity chart shows multiple stacked bars. Only PreToolUse and
 * PostToolUseFailure are posted (not SubagentStart) so this doesn't add
 * phantom children to seed-alpha's sub-agent tree — the chart's
 * sub-agent series is fed by the demo's real spawnSubagent calls in the
 * current hour. The tracker buckets these by `received_at`.
 */
async function seedActivity() {
  const HOUR = 60 * 60 * 1000;
  const now = Date.now();
  for (let h = 0; h < 6; h++) {
    const at = new Date(now - h * HOUR).toISOString();
    const calls = 3 + ((h * 7) % 9);
    for (let i = 0; i < calls; i++) {
      await postActivityAt("PreToolUse", at, {
        tool_name: "Bash",
        tool_input: { command: "ls" },
        tool_use_id: `act-${h}-${i}`,
      });
    }
    if (h === 1 || h === 3) {
      await postActivityAt("PostToolUseFailure", at, {
        tool_name: "Bash",
        tool_input: {},
        tool_use_id: `err-bash-${h}`,
      });
    }
    if (h === 2) {
      // 4 pytest calls, 1 fails → 25% rate (contrasts with Bash's low rate).
      for (let i = 0; i < 4; i++) {
        await postActivityAt("PreToolUse", at, {
          tool_name: "pytest",
          tool_input: {},
          tool_use_id: `pytest-${h}-${i}`,
        });
      }
      await postActivityAt("PostToolUseFailure", at, {
        tool_name: "pytest",
        tool_input: {},
        tool_use_id: `err-pytest-${h}`,
      });
    }
  }
  // Interruptions in the current hour. Each AskUserQuestion is paired with
  // its PostToolUse so seed-alpha returns to "running" rather than ending
  // stuck "blocked" — leaving it blocked would skew the session-topology
  // e2e tests. (beta also emits a PermissionRequest in demo() above.)
  const nowIso = new Date(now).toISOString();
  // A gated Bash command → drives a Bash(git push *) suggestion in the panel.
  await postActivityAt("PreToolUse", nowIso, {
    tool_name: "Bash",
    tool_input: { command: "git push origin main" },
    tool_use_id: "perm-pre",
  });
  await postActivityAt("PermissionRequest", nowIso, {
    message: "Allow Bash(git push origin main)?",
  });
  for (const id of ["ask-1", "ask-2"]) {
    const tool_input = { questions: [{ question: "Proceed?" }] };
    await postActivityAt("PreToolUse", nowIso, {
      tool_name: "AskUserQuestion",
      tool_input,
      tool_use_id: id,
    });
    await postActivityAt("PostToolUse", nowIso, {
      tool_name: "AskUserQuestion",
      tool_input,
      tool_use_id: id,
    });
  }
}

const scenarios = { demo };

async function main() {
  const fn = scenarios[scenario];
  if (!fn) {
    console.error(`unknown scenario: ${scenario}`);
    console.error(`available: ${Object.keys(scenarios).join(", ")}`);
    process.exit(1);
  }
  await fn();
}

main().catch((err) => {
  if (err?.cause?.code === "ECONNREFUSED" || err?.code === "ECONNREFUSED") {
    console.error(`seed: server not reachable at ${ENDPOINT} — is apps/server running?`);
  } else {
    console.error(err.stack ?? String(err));
  }
  process.exit(1);
});
