import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  backfillSessionSubagents,
  parseSubagentMeta,
  parseSubagentTranscript,
} from "./backfill.js";
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
