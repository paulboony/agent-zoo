import type { AgentKind } from "@agent-zoo/shared";
import type { Theme } from "./types.js";

const REQUIRED_TOKENS = [
  "--bg",
  "--fg",
  "--muted",
  "--accent",
  "--accent-2",
  "--status-running",
  "--status-waiting",
  "--status-idle",
  "--status-error",
];

const REQUIRED_KINDS: AgentKind[] = ["main", "code-reviewer", "explorer", "writer", "general"];

export interface ThemeValidationIssue {
  themeId: string;
  message: string;
}

export function validateThemes(themes: Record<string, Theme>): ThemeValidationIssue[] {
  const issues: ThemeValidationIssue[] = [];

  for (const theme of Object.values(themes)) {
    for (const kind of REQUIRED_KINDS) {
      const svg = theme.mascots[kind];
      if (!svg || svg.trim().length === 0) {
        issues.push({
          themeId: theme.id,
          message: `missing mascot SVG for kind "${kind}"`,
        });
      }
      if (svg?.includes("<script")) {
        issues.push({
          themeId: theme.id,
          message: `mascot SVG for "${kind}" contains forbidden <script> tag`,
        });
      }
    }

    for (const token of REQUIRED_TOKENS) {
      if (!theme.tokens[token]) {
        issues.push({
          themeId: theme.id,
          message: `missing token "${token}"`,
        });
      }
    }

    if (!theme.mascotsCss.includes("prefers-reduced-motion")) {
      issues.push({
        themeId: theme.id,
        message: "mascots.css must include a @media (prefers-reduced-motion) block",
      });
    }
  }

  return issues;
}
