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
  await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

async function demo() {
  // Two sessions starting in parallel
  await post({
    hook_event_name: "SessionStart",
    session_id: "seed-alpha",
    cwd: "/Users/demo/projects/alpha",
    transcript_path: "/Users/demo/.claude/projects/alpha.jsonl",
    source: "startup",
  });
  await post({
    hook_event_name: "SessionStart",
    session_id: "seed-beta",
    cwd: "/Users/demo/projects/beta",
    transcript_path: "/Users/demo/.claude/projects/beta.jsonl",
    source: "startup",
  });

  await sleep(150);

  // Alpha kicks off a Bash command
  await post({
    hook_event_name: "PreToolUse",
    session_id: "seed-alpha",
    cwd: "/Users/demo/projects/alpha",
    transcript_path: "/Users/demo/.claude/projects/alpha.jsonl",
    tool_name: "Bash",
    tool_input: { command: "pnpm test" },
    tool_use_id: "alpha-bash-1",
  });

  await sleep(150);

  // Alpha spawns a code-reviewer sub-agent
  await post({
    hook_event_name: "SubagentStart",
    session_id: "seed-alpha",
    cwd: "/Users/demo/projects/alpha",
    transcript_path: "/Users/demo/.claude/projects/alpha.jsonl",
    agent_id: "alpha-reviewer-1",
    agent_type: "code-reviewer",
    agent_transcript_path: "/Users/demo/.claude/projects/alpha-reviewer.jsonl",
  });

  await sleep(150);

  // Beta hits a permission prompt
  await post({
    hook_event_name: "PermissionRequest",
    session_id: "seed-beta",
    cwd: "/Users/demo/projects/beta",
    transcript_path: "/Users/demo/.claude/projects/beta.jsonl",
    message: "Allow Write to /etc/hosts?",
    title: "Permission needed",
  });

  await sleep(150);

  // Alpha sub-agent finishes
  await post({
    hook_event_name: "SubagentStop",
    session_id: "seed-alpha",
    cwd: "/Users/demo/projects/alpha",
    transcript_path: "/Users/demo/.claude/projects/alpha.jsonl",
    agent_id: "alpha-reviewer-1",
    agent_type: "code-reviewer",
    agent_transcript_path: "/Users/demo/.claude/projects/alpha-reviewer.jsonl",
  });

  await post({
    hook_event_name: "PostToolUse",
    session_id: "seed-alpha",
    cwd: "/Users/demo/projects/alpha",
    transcript_path: "/Users/demo/.claude/projects/alpha.jsonl",
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
  console.error(err.stack ?? String(err));
  process.exit(1);
});
