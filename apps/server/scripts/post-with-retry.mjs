/**
 * POST a body to `url`, retrying on transient connection failures.
 *
 * Purpose: in dev the agent-zoo server is briefly unreachable while
 * `tsx watch` restarts (~1–2s). Without retry, every Claude Code hook
 * fired in that window is silently dropped — `Stop` never lands,
 * status sticks at `running`, current_tool / current_activity go
 * stale. The handler must still NEVER throw (Claude Code's hooks
 * must not block its turn lifecycle), so terminal failures still
 * resolve, just to `null`.
 *
 * Only retries on connection-level errors (fetch rejecting, including
 * AbortError from per-attempt timeout). HTTP 4xx / 5xx responses are
 * returned to the caller without retry — they're not transient and
 * we shouldn't pile on a struggling server.
 */
export async function postWithRetry(url, body, opts = {}) {
  const {
    // Injectable for tests. Default to global fetch / setTimeout.
    fetch: fetchImpl = globalThis.fetch,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
    attempts = 3,
    perAttemptTimeoutMs = 800,
    backoffMs = 200,
  } = opts;

  for (let i = 0; i < attempts; i++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), perAttemptTimeoutMs);
    try {
      const res = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        signal: ac.signal,
      });
      // Got an HTTP response (any status). Stop retrying.
      return res;
    } catch {
      // Connection error or abort. Retry if we have budget.
      if (i < attempts - 1) {
        await sleep(backoffMs);
        continue;
      }
      // Last attempt — swallow and return null. Mirrors the original
      // handler's contract: never let the caller throw.
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}
