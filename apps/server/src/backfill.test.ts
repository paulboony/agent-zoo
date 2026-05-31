import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { SseMessage } from "@agent-zoo/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  backfillSessionSubagents,
  extractActivityEnvelopes,
  parseSubagentMeta,
  parseSubagentTranscript,
  refreshMainAgentModels,
  runWithConcurrency,
} from "./backfill.js";
import { createActivityTracker } from "./activity.js";
import { createStore, type Store } from "./state.js";

describe("parseSubagentMeta", () => {
  it("returns agentType and description from valid meta", () => {
    const result = parseSubagentMeta({
      agentType: "general-purpose",
      description: "Review the design",
    });
    expect(result).toEqual({
      agentType: "general-purpose",
      description: "Review the design",
    });
  });

  it("returns undefined fields when meta keys are missing", () => {
    expect(parseSubagentMeta({})).toEqual({});
  });

  it("ignores non-string field values", () => {
    expect(
      parseSubagentMeta({ agentType: 123, description: null }),
    ).toEqual({});
  });

  it("returns null for non-object input", () => {
    expect(parseSubagentMeta(null)).toBeNull();
    expect(parseSubagentMeta("string")).toBeNull();
    expect(parseSubagentMeta(42)).toBeNull();
  });
});

describe("parseSubagentTranscript", () => {
  it("returns zeros for empty input", () => {
    expect(parseSubagentTranscript([])).toEqual({
      tool_calls_count: 0,
      error_count: 0,
    });
  });

  it("counts tool_use entries", () => {
    const result = parseSubagentTranscript([
      { type: "tool_use", id: "t1" },
      { type: "tool_use", id: "t2" },
      { type: "text", text: "hi" },
    ]);
    expect(result.tool_calls_count).toBe(2);
    expect(result.error_count).toBe(0);
  });

  it("counts errored tool_result entries", () => {
    const result = parseSubagentTranscript([
      { type: "tool_result", is_error: false },
      { type: "tool_result", is_error: true },
      { type: "tool_result", is_error: true },
    ]);
    expect(result.error_count).toBe(2);
    expect(result.tool_calls_count).toBe(0);
  });

  it("extracts model from an assistant entry", () => {
    const result = parseSubagentTranscript([
      { type: "user", message: { content: "hello" } },
      { type: "assistant", message: { model: "claude-opus-4-7" } },
    ]);
    expect(result.model).toBe("claude-opus-4-7");
  });

  it("extracts prompt from the first user message (string content)", () => {
    const result = parseSubagentTranscript([
      { type: "user", message: { content: "Investigate X" } },
      { type: "assistant", message: { model: "x" } },
    ]);
    expect(result.prompt).toBe("Investigate X");
  });

  it("extracts prompt from the first user message (content blocks)", () => {
    const result = parseSubagentTranscript([
      {
        type: "user",
        message: {
          content: [
            { type: "text", text: "First chunk." },
            { type: "text", text: "Second chunk." },
          ],
        },
      },
    ]);
    expect(result.prompt).toBe("First chunk.\nSecond chunk.");
  });

  it("derives earliest/latest timestamps", () => {
    const result = parseSubagentTranscript([
      { type: "user", timestamp: "2026-05-15T10:00:00.000Z" },
      { type: "assistant", timestamp: "2026-05-15T10:01:00.000Z" },
      { type: "tool_use", timestamp: "2026-05-15T10:00:30.000Z" },
    ]);
    expect(result.started_at).toBe("2026-05-15T10:00:00.000Z");
    expect(result.last_event_at).toBe("2026-05-15T10:01:00.000Z");
  });

  it("skips malformed entries without throwing", () => {
    const result = parseSubagentTranscript([
      null,
      "not an object",
      42,
      { type: "tool_use" },
    ]);
    expect(result.tool_calls_count).toBe(1);
  });
});

const SID = "sess-test";

async function writeMeta(
  dir: string,
  agentId: string,
  meta: { agentType: string; description: string },
): Promise<void> {
  await fs.writeFile(
    path.join(dir, `agent-${agentId}.meta.json`),
    JSON.stringify(meta),
  );
}

async function writeTranscript(
  dir: string,
  agentId: string,
  entries: unknown[],
): Promise<void> {
  const file = path.join(dir, `agent-${agentId}.jsonl`);
  await fs.writeFile(file, entries.map((e) => JSON.stringify(e)).join("\n"));
}

async function setMtime(file: string, ms: number): Promise<void> {
  const t = new Date(ms);
  await fs.utimes(file, t, t);
}

describe("backfillSessionSubagents", () => {
  let tmp: string;
  let store: Store;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "agent-zoo-bf-"));
    store = createStore();
    store.sessions.set(SID, {
      id: SID,
      cwd: "/tmp",
      cwd_basename: "tmp",
      started_at: "2026-05-15T10:00:00.000Z",
      status: "ended",
      last_event_at: "2026-05-15T10:00:00.000Z",
      agents: {},
    });
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("does not touch a pre-existing main agent when recovering a sub-agent", async () => {
    // Seed a `main` agent the way replayJsonl would have, with a known
    // tool_calls_count and ended status.
    const session = store.sessions.get(SID);
    if (!session) throw new Error("test setup: session missing");
    session.agents.main = {
      id: "main",
      status: "ended",
      started_at: "2026-05-15T09:00:00.000Z",
      last_event_at: "2026-05-15T09:30:00.000Z",
      tool_calls_count: 42,
      error_count: 0,
    };

    await writeMeta(tmp, "a1", {
      agentType: "general-purpose",
      description: "Sub-agent",
    });
    await writeTranscript(tmp, "a1", [
      {
        type: "user",
        timestamp: "2026-05-15T10:00:00.000Z",
        message: { content: "go" },
      },
      { type: "tool_use", timestamp: "2026-05-15T10:00:30.000Z" },
    ]);

    await backfillSessionSubagents(
      store,
      SID,
      tmp,
      Date.now() - 60_000,
      new Date().toISOString(),
    );

    const main = store.sessions.get(SID)?.agents.main;
    expect(main?.tool_calls_count).toBe(42);
    expect(main?.status).toBe("ended");
    expect(main?.current_tool).toBeUndefined();
  });

  it("recovers a fresh sub-agent with label, prompt, and counters", async () => {
    await writeMeta(tmp, "a1", {
      agentType: "general-purpose",
      description: "Review the design",
    });
    await writeTranscript(tmp, "a1", [
      {
        type: "user",
        timestamp: "2026-05-15T10:00:00.000Z",
        message: { content: "Investigate X" },
      },
      {
        type: "assistant",
        timestamp: "2026-05-15T10:01:00.000Z",
        message: { model: "claude-opus-4-7" },
      },
      { type: "tool_use", timestamp: "2026-05-15T10:01:10.000Z" },
      { type: "tool_use", timestamp: "2026-05-15T10:01:20.000Z" },
    ]);

    const cutoff = Date.now() - 60_000;
    const result = await backfillSessionSubagents(
      store,
      SID,
      tmp,
      cutoff,
      new Date().toISOString(),
    );

    expect(result.recovered).toBe(1);
    expect(result.skipped).toBe(0);
    const agent = store.sessions.get(SID)?.agents["a1"];
    expect(agent).toBeDefined();
    expect(agent?.agent_type).toBe("general-purpose");
    expect(agent?.label).toBe("Review the design");
    expect(agent?.prompt).toBe("Investigate X");
    expect(agent?.tool_calls_count).toBe(2);
    expect(agent?.error_count).toBe(0);
    expect(agent?.model).toBe("claude-opus-4-7");
    expect(agent?.status).toBe("ended");
    expect(agent?.last_event_at).toBe("2026-05-15T10:01:20.000Z");
  });

  it("skips a sub-agent whose files are older than the cutoff", async () => {
    await writeMeta(tmp, "old", { agentType: "general-purpose", description: "stale" });
    await writeTranscript(tmp, "old", [
      { type: "user", timestamp: "2025-01-01T00:00:00.000Z" },
    ]);
    const oldMs = Date.now() - 2 * 24 * 60 * 60 * 1000;
    await setMtime(path.join(tmp, "agent-old.meta.json"), oldMs);
    await setMtime(path.join(tmp, "agent-old.jsonl"), oldMs);

    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const result = await backfillSessionSubagents(
      store,
      SID,
      tmp,
      cutoff,
      new Date().toISOString(),
    );

    expect(result.recovered).toBe(0);
    expect(result.skipped).toBe(1);
    expect(store.sessions.get(SID)?.agents["old"]).toBeUndefined();
  });

  it("skips when meta.json is missing", async () => {
    await writeTranscript(tmp, "nometa", [
      { type: "user", timestamp: "2026-05-15T10:00:00.000Z" },
    ]);

    const cutoff = Date.now() - 60_000;
    const result = await backfillSessionSubagents(
      store,
      SID,
      tmp,
      cutoff,
      new Date().toISOString(),
    );

    expect(result.recovered).toBe(0);
    expect(result.skipped).toBe(0);
    expect(store.sessions.get(SID)?.agents["nometa"]).toBeUndefined();
  });

  it("tolerates malformed JSON lines in the transcript", async () => {
    await writeMeta(tmp, "a2", { agentType: "general-purpose", description: "ok" });
    const file = path.join(tmp, "agent-a2.jsonl");
    await fs.writeFile(
      file,
      [
        JSON.stringify({
          type: "user",
          timestamp: "2026-05-15T10:00:00.000Z",
          message: { content: "hi" },
        }),
        "{not valid json}",
        JSON.stringify({ type: "tool_use", timestamp: "2026-05-15T10:01:00.000Z" }),
      ].join("\n"),
    );

    const cutoff = Date.now() - 60_000;
    const result = await backfillSessionSubagents(
      store,
      SID,
      tmp,
      cutoff,
      new Date().toISOString(),
    );

    expect(result.recovered).toBe(1);
    const agent = store.sessions.get(SID)?.agents["a2"];
    expect(agent?.tool_calls_count).toBe(1);
    expect(agent?.label).toBe("ok");
  });

  it("returns recovered:0 when the directory doesn't exist", async () => {
    const result = await backfillSessionSubagents(
      store,
      SID,
      path.join(tmp, "no-such-dir"),
      Date.now() - 60_000,
      new Date().toISOString(),
    );
    expect(result).toEqual({ recovered: 0, skipped: 0 });
  });
});

describe("replayJsonl (via runBackfill)", () => {
  // We exercise replayJsonl through its public entry runBackfill to keep
  // the test on the public surface. The bug being guarded is that the
  // post-replay main.model patch and the last_event_at bump used to
  // mutate the already-committed SessionState object in place.

  let home: string;
  let store: Store;
  let prevHome: string | undefined;

  beforeEach(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), "agent-zoo-rj-"));
    await fs.mkdir(path.join(home, "projects", "demo"), { recursive: true });
    prevHome = process.env.CLAUDE_HOME;
    process.env.CLAUDE_HOME = home;
    store = createStore();
  });

  afterEach(async () => {
    if (prevHome === undefined) delete process.env.CLAUDE_HOME;
    else process.env.CLAUDE_HOME = prevHome;
    await fs.rm(home, { recursive: true, force: true });
  });

  it("does not mutate already-committed SessionState objects when patching model + last_event_at", async () => {
    // Detection strategy: freeze every SessionState the moment it is
    // committed via store.sessions.set. If replayJsonl tries to mutate
    // a committed object in place (the pre-fix bug), the assignment
    // throws in strict mode. Post-fix it must allocate a new draft and
    // store.sessions.set that instead.
    const sid = "sess-rj";
    const oldTs = "2026-05-15T09:00:00.000Z";
    const projectsDir = path.join(home, "projects", "demo");
    const jsonl = path.join(projectsDir, `${sid}.jsonl`);
    await fs.writeFile(
      jsonl,
      `${JSON.stringify({
        type: "assistant",
        sessionId: sid,
        cwd: "/tmp",
        transcriptPath: jsonl,
        timestamp: oldTs,
        message: { model: "claude-sonnet-4-7" },
      })}\n`,
    );

    const origSet = store.sessions.set.bind(store.sessions);
    store.sessions.set = (key, value) => {
      Object.freeze(value);
      Object.freeze(value.agents);
      for (const a of Object.values(value.agents)) Object.freeze(a);
      return origSet(key, value);
    };

    const { runBackfill } = await import("./backfill.js");
    // Pre-fix: this throws because replayJsonl writes `main.model = ...`
    // and `session.last_event_at = ...` directly onto the frozen object
    // that reduce() just committed. Post-fix: replayJsonl builds a fresh
    // SessionState and re-sets, so the freeze on the prior object is fine.
    await runBackfill(store);

    const committed = store.sessions.get(sid);
    expect(committed?.agents.main?.model).toBe("claude-sonnet-4-7");
  });
});

describe("backfill last_user_prompt seeding", () => {
  let home: string;
  let store: Store;
  let prevHome: string | undefined;

  beforeEach(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), "agent-zoo-lup-"));
    await fs.mkdir(path.join(home, "projects", "demo"), { recursive: true });
    prevHome = process.env.CLAUDE_HOME;
    process.env.CLAUDE_HOME = home;
    store = createStore();
  });

  afterEach(async () => {
    if (prevHome === undefined) delete process.env.CLAUDE_HOME;
    else process.env.CLAUDE_HOME = prevHome;
    await fs.rm(home, { recursive: true, force: true });
  });

  it("sets last_user_prompt from the last user entry in the JSONL", async () => {
    const sid = "sess-lup-1";
    const jsonl = path.join(home, "projects", "demo", `${sid}.jsonl`);
    const lines = [
      {
        type: "user",
        role: "user",
        sessionId: sid,
        cwd: "/tmp",
        transcriptPath: jsonl,
        timestamp: "2026-05-15T10:00:00.000Z",
        message: { content: "first ask" },
      },
      {
        type: "assistant",
        role: "assistant",
        sessionId: sid,
        cwd: "/tmp",
        transcriptPath: jsonl,
        timestamp: "2026-05-15T10:00:01.000Z",
        message: { model: "claude-sonnet-4-7" },
      },
      {
        type: "user",
        role: "user",
        sessionId: sid,
        cwd: "/tmp",
        transcriptPath: jsonl,
        timestamp: "2026-05-15T10:00:02.000Z",
        message: { content: "  fix the\nbug  " },
      },
    ];
    await fs.writeFile(jsonl, `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`);

    const { runBackfill } = await import("./backfill.js");
    await runBackfill(store);

    expect(store.sessions.get(sid)?.last_user_prompt).toBe("fix the bug");
  });

  it("leaves last_user_prompt absent when no user entries are present", async () => {
    const sid = "sess-lup-2";
    const jsonl = path.join(home, "projects", "demo", `${sid}.jsonl`);
    const onlyAssistant = {
      type: "assistant",
      role: "assistant",
      sessionId: sid,
      cwd: "/tmp",
      transcriptPath: jsonl,
      timestamp: "2026-05-15T10:00:01.000Z",
      message: { model: "claude-sonnet-4-7" },
    };
    await fs.writeFile(jsonl, `${JSON.stringify(onlyAssistant)}\n`);

    const { runBackfill } = await import("./backfill.js");
    await runBackfill(store);

    const session = store.sessions.get(sid);
    expect(session).toBeDefined();
    expect(session?.last_user_prompt).toBeUndefined();
  });
});

describe("refreshMainAgentModels", () => {
  let home: string;
  let store: Store;
  let prevHome: string | undefined;

  beforeEach(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), "agent-zoo-rmm-"));
    await fs.mkdir(path.join(home, "projects", "demo"), { recursive: true });
    prevHome = process.env.CLAUDE_HOME;
    process.env.CLAUDE_HOME = home;
    store = createStore();
  });

  afterEach(async () => {
    if (prevHome === undefined) delete process.env.CLAUDE_HOME;
    else process.env.CLAUDE_HOME = prevHome;
    await fs.rm(home, { recursive: true, force: true });
  });

  it("commits the model via a fresh SessionState and broadcasts an upsert", async () => {
    const sid = "sess-rmm";
    store.sessions.set(sid, {
      id: sid,
      cwd: "/tmp",
      cwd_basename: "tmp",
      started_at: "2026-05-15T10:00:00.000Z",
      last_event_at: "2026-05-15T10:00:00.000Z",
      status: "running",
      agents: {
        main: {
          id: "main",
          status: "running",
          started_at: "2026-05-15T10:00:00.000Z",
          last_event_at: "2026-05-15T10:00:00.000Z",
          tool_calls_count: 1,
          error_count: 0,
        },
      },
    });
    const prevSession = store.sessions.get(sid);
    const prevSeq = store.seq;

    // Write a JSONL with an assistant entry carrying the model.
    const jsonl = path.join(home, "projects", "demo", `${sid}.jsonl`);
    await fs.writeFile(
      jsonl,
      `${JSON.stringify({
        type: "assistant",
        sessionId: sid,
        timestamp: new Date().toISOString(),
        message: { model: "claude-sonnet-4-7" },
      })}\n`,
    );

    const upserts: SseMessage[] = [];
    store.subscribers.add((m) => upserts.push(m));

    await refreshMainAgentModels(store);

    // Model is set on the (new) session object in the store
    const next = store.sessions.get(sid);
    expect(next?.agents.main?.model).toBe("claude-sonnet-4-7");
    // Store invariant: committing a change must allocate a new SessionState
    expect(next).not.toBe(prevSession);
    // seq bumped and an upsert broadcast so SSE clients learn about the change
    expect(store.seq).toBe(prevSeq + 1);
    expect(upserts).toHaveLength(1);
    expect(upserts[0]).toMatchObject({
      type: "session_upsert",
      seq: prevSeq + 1,
    });
  });

  it("does not emit when no targets have missing models", async () => {
    const sid = "sess-rmm-noop";
    store.sessions.set(sid, {
      id: sid,
      cwd: "/tmp",
      cwd_basename: "tmp",
      started_at: "2026-05-15T10:00:00.000Z",
      last_event_at: "2026-05-15T10:00:00.000Z",
      status: "running",
      agents: {
        main: {
          id: "main",
          status: "running",
          started_at: "2026-05-15T10:00:00.000Z",
          last_event_at: "2026-05-15T10:00:00.000Z",
          tool_calls_count: 0,
          error_count: 0,
          model: "claude-sonnet-4-7",
        },
      },
    });
    const prevSeq = store.seq;
    const upserts: SseMessage[] = [];
    store.subscribers.add((m) => upserts.push(m));

    await refreshMainAgentModels(store);

    expect(store.seq).toBe(prevSeq);
    expect(upserts).toHaveLength(0);
  });
});

describe("extractActivityEnvelopes", () => {
  const T = "2026-06-01T10:00:00.000Z";

  it("returns no envelopes for empty input", () => {
    expect(extractActivityEnvelopes([])).toEqual([]);
  });

  it("synthesises a PreToolUse envelope per tool_use block in an assistant entry", () => {
    const envs = extractActivityEnvelopes([
      {
        type: "assistant",
        sessionId: "s1",
        cwd: "/repo",
        timestamp: T,
        message: {
          content: [
            { type: "text", text: "ok" },
            { type: "tool_use", id: "u1", name: "Bash", input: { command: "ls" } },
            { type: "tool_use", id: "u2", name: "Read", input: { file_path: "/x" } },
          ],
        },
      },
    ]);
    expect(envs).toHaveLength(2);
    expect(envs[0]).toEqual({
      received_at: T,
      payload: {
        hook_event_name: "PreToolUse",
        session_id: "s1",
        cwd: "/repo",
        transcript_path: "",
        tool_name: "Bash",
        tool_input: { command: "ls" },
        tool_use_id: "u1",
      },
    });
    expect(envs[1]?.payload).toMatchObject({ tool_name: "Read", tool_use_id: "u2" });
  });

  it("emits PostToolUseFailure for an errored tool_result, attributing the tool via tool_use_id", () => {
    const envs = extractActivityEnvelopes([
      {
        type: "assistant",
        sessionId: "s1",
        timestamp: T,
        message: { content: [{ type: "tool_use", id: "u1", name: "Bash", input: {} }] },
      },
      {
        type: "user",
        sessionId: "s1",
        timestamp: "2026-06-01T10:00:05.000Z",
        message: { content: [{ type: "tool_result", tool_use_id: "u1", is_error: true }] },
      },
    ]);
    const failures = envs.filter((e) => e.payload.hook_event_name === "PostToolUseFailure");
    expect(failures).toHaveLength(1);
    expect(failures[0]?.payload).toMatchObject({ tool_name: "Bash", tool_use_id: "u1" });
    expect(failures[0]?.received_at).toBe("2026-06-01T10:00:05.000Z");
  });

  it("ignores non-errored tool_result blocks", () => {
    const envs = extractActivityEnvelopes([
      {
        type: "assistant",
        sessionId: "s1",
        timestamp: T,
        message: { content: [{ type: "tool_use", id: "u1", name: "Bash", input: {} }] },
      },
      {
        type: "user",
        sessionId: "s1",
        timestamp: T,
        message: { content: [{ type: "tool_result", tool_use_id: "u1", is_error: false }] },
      },
    ]);
    expect(envs.filter((e) => e.payload.hook_event_name === "PostToolUseFailure")).toEqual([]);
  });

  it("skips an errored tool_result whose tool_use_id was never seen", () => {
    const envs = extractActivityEnvelopes([
      {
        type: "user",
        sessionId: "s1",
        timestamp: T,
        message: { content: [{ type: "tool_result", tool_use_id: "ghost", is_error: true }] },
      },
    ]);
    expect(envs).toEqual([]);
  });

  it("skips entries with no timestamp", () => {
    expect(
      extractActivityEnvelopes([
        {
          type: "assistant",
          sessionId: "s1",
          message: { content: [{ type: "tool_use", id: "u1", name: "Bash", input: {} }] },
        },
      ]),
    ).toEqual([]);
  });

  it("skips entries with no session id", () => {
    expect(
      extractActivityEnvelopes([
        {
          type: "assistant",
          timestamp: T,
          message: { content: [{ type: "tool_use", id: "u1", name: "Bash", input: {} }] },
        },
      ]),
    ).toEqual([]);
  });

  it("skips sub-agent entries that carry an agentId", () => {
    expect(
      extractActivityEnvelopes([
        {
          type: "assistant",
          sessionId: "s1",
          agentId: "a1",
          timestamp: T,
          message: { content: [{ type: "tool_use", id: "u1", name: "Bash", input: {} }] },
        },
      ]),
    ).toEqual([]);
  });

  it("accepts snake_case session_id and reads cwd", () => {
    const envs = extractActivityEnvelopes([
      {
        type: "assistant",
        session_id: "s2",
        cwd: "/w",
        timestamp: T,
        message: { content: [{ type: "tool_use", id: "u1", name: "Grep", input: {} }] },
      },
    ]);
    expect(envs[0]?.payload).toMatchObject({ session_id: "s2", cwd: "/w", tool_name: "Grep" });
  });
});

describe("extractActivityEnvelopes feeds the activity tracker", () => {
  it("counts tool calls and failures by tool in the 24h snapshot", () => {
    const now = Date.parse("2026-06-01T10:30:00.000Z");
    const ts = "2026-06-01T10:00:00.000Z";
    const entries = [
      {
        type: "assistant",
        sessionId: "s1",
        cwd: "/r",
        timestamp: ts,
        message: {
          content: [
            { type: "tool_use", id: "u1", name: "Bash", input: { command: "ls" } },
            { type: "tool_use", id: "u2", name: "Read", input: {} },
          ],
        },
      },
      {
        type: "user",
        sessionId: "s1",
        timestamp: ts,
        message: { content: [{ type: "tool_result", tool_use_id: "u1", is_error: true }] },
      },
    ];
    const tracker = createActivityTracker();
    for (const env of extractActivityEnvelopes(entries)) tracker.record(env);
    const snap = tracker.snapshot(now);
    const totalCalls = snap.buckets.reduce((acc, b) => acc + b.tool_calls, 0);
    expect(totalCalls).toBe(2);
    expect(snap.failures_by_tool).toEqual([{ tool: "Bash", count: 1, calls: 1 }]);
  });
});

describe("runWithConcurrency", () => {
  it("processes every item exactly once", async () => {
    const seen: number[] = [];
    await runWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => {
      seen.push(n);
    });
    expect(seen.slice().sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });

  it("never runs more workers than the limit", async () => {
    let active = 0;
    let maxActive = 0;
    await runWithConcurrency([1, 2, 3, 4, 5, 6], 2, async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
    });
    expect(maxActive).toBe(2);
  });

  it("runs nothing for an empty list", async () => {
    let calls = 0;
    await runWithConcurrency([], 4, async () => {
      calls++;
    });
    expect(calls).toBe(0);
  });

  it("caps workers at the item count when the limit exceeds it", async () => {
    let active = 0;
    let maxActive = 0;
    await runWithConcurrency([1, 2], 8, async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
    });
    expect(maxActive).toBe(2);
  });

  it("passes the item index to the worker", async () => {
    const pairs: Array<[string, number]> = [];
    await runWithConcurrency(["a", "b", "c"], 1, async (item, i) => {
      pairs.push([item, i]);
    });
    expect(pairs).toEqual([
      ["a", 0],
      ["b", 1],
      ["c", 2],
    ]);
  });
});
