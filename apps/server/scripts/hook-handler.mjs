#!/usr/bin/env node
const HARD_TIMEOUT_MS = 5000;
const HTTP_TIMEOUT_MS = 3000;
const URL = process.env.CLAUDE_DASHBOARD_URL ?? "http://127.0.0.1:7777/hook";

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

  const ac = new AbortController();
  const timeout = setTimeout(() => ac.abort(), HTTP_TIMEOUT_MS);
  try {
    await fetch(URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      signal: ac.signal,
    });
  } catch {
    // swallow; CC must not block on us
  } finally {
    clearTimeout(timeout);
    process.exit(0);
  }
});
process.stdin.on("error", () => process.exit(0));
