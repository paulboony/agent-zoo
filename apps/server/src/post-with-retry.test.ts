import { describe, expect, it, vi } from "vitest";
// @ts-expect-error - .mjs sibling under scripts/, no type declarations.
import { postWithRetry } from "../scripts/post-with-retry.mjs";

const URL = "http://test/hook";
const BODY = '{"x":1}';

describe("postWithRetry", () => {
  it("calls fetch once and returns the response when reachable on first try", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const sleep = vi.fn();

    const res = await postWithRetry(URL, BODY, { fetch, sleep, attempts: 3 });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(res?.status).toBe(204);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("retries on connection error and returns success when a later attempt lands", async () => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("ECONNREFUSED 127.0.0.1:7777"))
      .mockResolvedValue(new Response(null, { status: 204 }));
    const sleep = vi.fn().mockResolvedValue(undefined);

    const res = await postWithRetry(URL, BODY, {
      fetch,
      sleep,
      attempts: 3,
      backoffMs: 200,
    });

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(res?.status).toBe(204);
    // One backoff between the two attempts.
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(200);
  });

  it("after all attempts fail with connection errors, resolves to null (never throws)", async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError("ECONNREFUSED"));
    const sleep = vi.fn().mockResolvedValue(undefined);

    const res = await postWithRetry(URL, BODY, {
      fetch,
      sleep,
      attempts: 3,
      backoffMs: 200,
    });

    expect(res).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(3);
    // N-1 sleeps between attempts; no sleep after the final failure.
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry on HTTP error responses (4xx/5xx are not transient)", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("nope", { status: 500 }));
    const sleep = vi.fn();

    const res = await postWithRetry(URL, BODY, { fetch, sleep, attempts: 3 });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(res?.status).toBe(500);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("aborts each attempt at perAttemptTimeoutMs so a stuck attempt doesn't eat the whole budget", async () => {
    // Simulate a fetch that hangs until aborted. We resolve only when
    // the AbortSignal fires, mimicking the underlying socket close.
    const fetch = vi.fn((_url: string, init: { signal: AbortSignal }) => {
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    });
    const sleep = vi.fn().mockResolvedValue(undefined);

    const start = Date.now();
    const res = await postWithRetry(URL, BODY, {
      fetch,
      sleep,
      attempts: 2,
      perAttemptTimeoutMs: 50,
      backoffMs: 0,
    });
    const elapsed = Date.now() - start;

    expect(res).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
    // Two attempts × 50ms each, plus a tiny scheduler overhead. Cap at
    // a generous upper bound to keep the test stable on slow CI.
    expect(elapsed).toBeLessThan(500);
  });
});
