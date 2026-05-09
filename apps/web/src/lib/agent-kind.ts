import type { AgentKind, AgentState } from "@agent-zoo/shared";

/**
 * UI-side mascot rules. Each rule maps a label pattern to an AgentKind.
 * Order matters — the first match wins.
 *
 * Why label-based instead of agent_type-based: in real usage almost every
 * sub-agent is dispatched with `subagent_type: "general-purpose"` (the
 * server resolves that to `kind: "general"`), so the user-supplied
 * description on the parent's Task tool is the only signal of what the
 * sub-agent is actually doing.
 *
 * Add or tweak rules here; nothing else needs to change.
 */
const LABEL_RULES: { pattern: RegExp; kind: AgentKind }[] = [
  // Reviewers / auditors. Caught before "writer" so "spec review" lands
  // on the reviewer mascot rather than the writer mascot.
  { pattern: /review|audit|critique|inspect/i, kind: "code-reviewer" },
  // Explorers — read-only investigation, navigation, debugging.
  { pattern: /explor|search|find|investigat|locat|grep|trace|debug/i, kind: "explorer" },
  // Writers / builders — anything that produces code, prose, or a plan.
  // Common superpowers task labels start with "Implement Task N",
  // "Fix [bug]", "Build [thing]", "Refactor [code]".
  {
    pattern: /implement|build|creat|writ|document|spec|plan|design|draft|refactor|fix\b|\badd\b/i,
    kind: "writer",
  },
];

/**
 * Pick the mascot kind to display for an agent. Tries the label rules
 * first; falls back to the server-resolved `agent.kind` (which itself
 * came from `agent_type`).
 */
export function resolveDisplayKind(agent: AgentState): AgentKind {
  if (agent.id === "main") return "main";
  if (agent.label) {
    for (const rule of LABEL_RULES) {
      if (rule.pattern.test(agent.label)) return rule.kind;
    }
  }
  return agent.kind;
}
