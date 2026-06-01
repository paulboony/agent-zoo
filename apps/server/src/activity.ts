// apps/server/src/activity.ts
import type {
  ActivityBucket,
  ActivityResponse,
  HookEnvelope,
  PermissionSuggestion,
  ToolFailureCount,
} from "@agent-zoo/shared";

const HOUR_MS = 60 * 60 * 1000;
const WINDOW_HOURS = 24;
const TOP_SUGGESTIONS = 6;

interface Counts {
  tool_calls: number;
  fixable: number; // permission prompts (allowlist-fixable)
  needs_you: number; // elicitation + AskUserQuestion
  calls: Record<string, number>; // tool_name -> call count
  failures: Record<string, number>; // tool_name -> failure count
  suggestions: Record<string, number>; // rule -> count
}

export interface ActivityTracker {
  /** Record a hook event into the current hour's bucket. */
  record(env: HookEnvelope): void;
  /** Roll/prune to `now` (epoch ms) and return the 24h snapshot. */
  snapshot(now: number): ActivityResponse;
}

function hourStart(ms: number): number {
  return Math.floor(ms / HOUR_MS) * HOUR_MS;
}

function emptyCounts(): Counts {
  return { tool_calls: 0, fixable: 0, needs_you: 0, calls: {}, failures: {}, suggestions: {} };
}

/** Bash command string from a PreToolUse tool_input, if present. */
function bashCommand(toolInput: unknown): string | undefined {
  if (toolInput && typeof toolInput === "object" && "command" in toolInput) {
    const cmd = (toolInput as { command?: unknown }).command;
    if (typeof cmd === "string") return cmd;
  }
  return undefined;
}

// A "subcommand" is a bare word: starts with a letter, then word chars or
// hyphens. This deliberately excludes flags (`-C`), paths (`/repo`,
// `notes.md`), URLs (`https://x`), redirects (`>`), and quoted args (`"x"`),
// so we don't mistake a flag or its argument for the real subcommand.
const SUBCOMMAND_TOKEN = /^[A-Za-z][\w-]*$/;

// Tools that are inherently user-interaction (the agent asking the user) —
// AskUserQuestion poses a question, ExitPlanMode asks the user to approve a
// plan. They block on the user but are never permission-gated, so an allow
// rule for them is meaningless and they don't produce allow-rule suggestions.
const NON_GATEABLE_TOOLS = new Set(["AskUserQuestion", "ExitPlanMode"]);

/** Suggested allowlist rule for a gated tool/command (program + subcommand for Bash). */
function deriveRule(tool: string, command: string | undefined): string {
  if (tool !== "Bash" || !command) return tool;
  // A leading `cd <dir> &&` is noise: suggesting `Bash(cd <dir> *)` would
  // allow *any* command run in that directory. Split on shell separators
  // and pick the first sub-command that isn't a `cd`. (Heuristic — quoted
  // separators aren't parsed; the card says "review before applying".)
  const segments = command
    .split(/&&|\|\|?|;/)
    .map((s) => s.trim())
    .filter(Boolean);
  const meaningful = segments.find((s) => !/^cd(\s|$)/.test(s)) ?? command.trim();
  const tokens = meaningful.split(/\s+/);
  const prog = tokens[0];
  if (!prog) return tool;
  // `cd <anything>` always collapses to a path-agnostic rule.
  if (prog === "cd") return "Bash(cd *)";
  // The subcommand is the first bare word after the program, so a global
  // flag and its argument (`git -C /repo push` → `git push`) or a redirect
  // (`cat > notes.md` → `cat`) don't end up in the rule. Falls back to
  // prog-only when there's no real subcommand (`curl -s https://x` → `curl`).
  const sub = tokens.slice(1).find((t) => SUBCOMMAND_TOKEN.test(t));
  return sub ? `Bash(${prog} ${sub} *)` : `Bash(${prog} *)`;
}

export function createActivityTracker(): ActivityTracker {
  const buckets = new Map<number, Counts>();
  const pending = new Map<string, { tool: string; command?: string }>();

  function at(hourMs: number): Counts {
    let c = buckets.get(hourMs);
    if (!c) {
      c = emptyCounts();
      buckets.set(hourMs, c);
    }
    return c;
  }

  function addSuggestion(c: Counts, sid: string): void {
    const pend = pending.get(sid);
    if (!pend) return;
    // Interaction tools like AskUserQuestion are the agent asking the user —
    // they're never permission-gated, so an allow rule for them is
    // meaningless. Skip them as suggestions (they still count as needs_you).
    if (NON_GATEABLE_TOOLS.has(pend.tool)) return;
    const rule = deriveRule(pend.tool, pend.command);
    c.suggestions[rule] = (c.suggestions[rule] ?? 0) + 1;
  }

  return {
    record(env) {
      const t = Date.parse(env.received_at);
      if (Number.isNaN(t)) return;
      const p = env.payload;
      const sid = p.session_id;
      const h = hourStart(t);
      switch (p.hook_event_name) {
        case "PreToolUse": {
          const c = at(h);
          c.tool_calls += 1;
          c.calls[p.tool_name] = (c.calls[p.tool_name] ?? 0) + 1;
          const cmd = bashCommand(p.tool_input);
          pending.set(sid, cmd !== undefined ? { tool: p.tool_name, command: cmd } : { tool: p.tool_name });
          if (p.tool_name === "AskUserQuestion") c.needs_you += 1;
          break;
        }
        case "PostToolUse":
          pending.delete(sid);
          break;
        case "PostToolUseFailure": {
          const c = at(h);
          c.failures[p.tool_name] = (c.failures[p.tool_name] ?? 0) + 1;
          pending.delete(sid);
          break;
        }
        case "SessionEnd":
          pending.delete(sid);
          break;
        case "Notification": {
          if (p.notification_type === "permission_prompt") {
            const c = at(h);
            c.fixable += 1;
            addSuggestion(c, sid);
          } else if (p.notification_type === "elicitation_dialog") {
            at(h).needs_you += 1;
          }
          break;
        }
        case "PermissionRequest": {
          const c = at(h);
          c.fixable += 1;
          addSuggestion(c, sid);
          break;
        }
        case "Elicitation":
          at(h).needs_you += 1;
          break;
      }
    },

    snapshot(now) {
      const currentHour = hourStart(now);
      const oldest = currentHour - (WINDOW_HOURS - 1) * HOUR_MS;
      for (const k of buckets.keys()) {
        if (k < oldest) buckets.delete(k);
      }
      const out: ActivityBucket[] = [];
      let fixable = 0;
      let needs_you = 0;
      const failureTotals: Record<string, number> = {};
      const callTotals: Record<string, number> = {};
      const suggestionTotals: Record<string, number> = {};
      for (let i = 0; i < WINDOW_HOURS; i++) {
        const h = oldest + i * HOUR_MS;
        const c = buckets.get(h);
        out.push({ hour_start: new Date(h).toISOString(), tool_calls: c?.tool_calls ?? 0 });
        if (c) {
          fixable += c.fixable;
          needs_you += c.needs_you;
          for (const [tool, n] of Object.entries(c.failures)) {
            failureTotals[tool] = (failureTotals[tool] ?? 0) + n;
          }
          for (const [tool, n] of Object.entries(c.calls)) {
            callTotals[tool] = (callTotals[tool] ?? 0) + n;
          }
          for (const [rule, n] of Object.entries(c.suggestions)) {
            suggestionTotals[rule] = (suggestionTotals[rule] ?? 0) + n;
          }
        }
      }
      const rate = (f: ToolFailureCount) => f.count / Math.max(f.calls, f.count);
      const failures_by_tool: ToolFailureCount[] = Object.entries(failureTotals)
        .map(([tool, count]) => ({ tool, count, calls: callTotals[tool] ?? 0 }))
        .sort((a, b) => rate(b) - rate(a) || b.count - a.count);
      const suggestions: PermissionSuggestion[] = Object.entries(suggestionTotals)
        .map(([rule, count]) => ({ rule, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, TOP_SUGGESTIONS);
      return {
        generated_at: new Date(now).toISOString(),
        buckets: out,
        interruptions_24h: fixable + needs_you,
        failures_by_tool,
        permissions: { fixable, needs_you, suggestions },
      };
    },
  };
}
