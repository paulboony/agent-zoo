#!/usr/bin/env node
const ENDPOINT = process.env.CLAUDE_DASHBOARD_URL ?? "http://127.0.0.1:7777/hook";

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
async function spawnSubagent({ id, description, subagent_type = "general-purpose" }) {
  await post({
    hook_event_name: "PreToolUse",
    session_id: "seed-alpha",
    cwd: ALPHA_CWD,
    transcript_path: ALPHA_TX,
    tool_name: "Task",
    tool_input: { description, subagent_type, prompt: description },
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

  await sleep(150);

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

  await sleep(100);

  // Alpha spawns four sub-agents — one per label-rule mascot kind, all
  // dispatched as `general-purpose` (matches real superpowers usage).
  await spawnSubagent({
    id: "alpha-reviewer-1",
    description: "Final review of feature",
  });
  await sleep(80);
  await spawnSubagent({
    id: "alpha-explorer-1",
    description: "Explore the codebase",
  });
  await sleep(80);
  await spawnSubagent({
    id: "alpha-coder-1",
    description: "Implement Task 5",
  });
  await sleep(80);
  await spawnSubagent({
    id: "alpha-writer-1",
    description: "Write notification spec",
  });

  await sleep(150);

  // Beta hits a permission prompt
  await post({
    hook_event_name: "PermissionRequest",
    session_id: "seed-beta",
    cwd: BETA_CWD,
    transcript_path: BETA_TX,
    message: "Allow Write to /etc/hosts?",
    title: "Permission needed",
  });

  await sleep(150);

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

  console.log("seed: demo scenario complete");
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
