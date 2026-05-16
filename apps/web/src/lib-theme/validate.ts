import type { MascotKind, Theme } from "./types.js";

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

const REQUIRED_KINDS: MascotKind[] = [
  "main",
  "code-reviewer",
  "explorer",
  "writer",
  "coder",
  "general",
];

export interface ThemeValidationIssue {
  themeId: string;
  message: string;
}

export function validateThemes(themes: Record<string, Theme>): ThemeValidationIssue[] {
  const issues: ThemeValidationIssue[] = [];

  for (const theme of Object.values(themes)) {
    // SVG fallbacks are only required for svg-mode themes. Sprite-mode
    // themes get their per-kind imagery from the sprite sheet.
    const requireSvgs = theme.mascotMode !== "sprite";
    for (const kind of REQUIRED_KINDS) {
      const svg = theme.mascots[kind];
      if (requireSvgs && (!svg || svg.trim().length === 0)) {
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

    if (theme.mascotMode === "sprite") {
      if (!theme.mascotSpriteUrl) {
        issues.push({
          themeId: theme.id,
          message: "mascot_mode is 'sprite' but mascots/sprites.png is missing",
        });
      }
      if (!theme.mascotSprite) {
        issues.push({
          themeId: theme.id,
          message: "mascot_mode is 'sprite' but mascot_sprite spec is missing in theme.json",
        });
      } else {
        for (const kind of REQUIRED_KINDS) {
          if (theme.mascotSprite.rows[kind] === undefined) {
            issues.push({
              themeId: theme.id,
              message: `mascot_sprite.rows missing entry for kind "${kind}"`,
            });
          }
        }
        for (const state of ["running", "waiting", "idle", "error"] as const) {
          if (!theme.mascotSprite.states[state]) {
            issues.push({
              themeId: theme.id,
              message: `mascot_sprite.states missing entry for state "${state}"`,
            });
          }
        }
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
