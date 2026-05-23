#!/usr/bin/env node
import { postWithRetry } from "./post-with-retry.mjs";

const HARD_TIMEOUT_MS = 5000;
const ENDPOINT = process.env.CLAUDE_DASHBOARD_ENDPOINT ?? "http://127.0.0.1:7777/hook";

// Per-attempt timeout × max attempts + backoff between attempts must
// stay safely under HARD_TIMEOUT_MS. With the defaults below the
// worst-case is ~3.2s (3 × 800ms fetch + 2 × 200ms backoff), well
// inside the 5s ceiling that bounds Claude Code's hook wait.
const RETRY_OPTS = {
  attempts: 3,
  perAttemptTimeoutMs: 800,
  backoffMs: 200,
};

const safety = setTimeout(() => process.exit(0), HARD_TIMEOUT_MS);
safety.unref();

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  raw += chunk;
});
process.stdin.on("end", async () => {
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    payload = { _raw: raw };
  }

  const body = JSON.stringify({
    received_at: new Date().toISOString(),
    payload,
  });

  // Retry briefly on connection failures. The original handler did one
  // attempt and swallowed errors, which silently dropped every hook
  // event that fired during transient server downtime (e.g., `tsx
  // watch` reload, ~1–2s). Lost `Stop` or `PostToolUse` events leave
  // session state stuck — see git log for the rationale.
  await postWithRetry(ENDPOINT, body, RETRY_OPTS);

  process.exit(0);
});
process.stdin.on("error", () => process.exit(0));
