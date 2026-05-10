import type { AgentKind } from "@agent-zoo/shared";

export type ThemeTokens = Record<string, string>;

export type MascotMode = "svg" | "sprite";
export type MascotState = "running" | "waiting" | "idle" | "error";

export interface SpriteCell {
  width: number;
  height: number;
}

export interface SpriteGap {
  x?: number;
  y?: number;
}

export interface SpriteStateRange {
  /** Column index where this state's frames begin. */
  start: number;
  /** Number of frames; `1` means a static cell (no animation). */
  count: number;
  /** Animation speed when `count > 1`. Defaults to 8. */
  fps?: number;
}

export interface MascotSpriteSpec {
  cell: SpriteCell;
  gap?: SpriteGap;
  rows: Record<AgentKind, number>;
  states: Record<MascotState, SpriteStateRange>;
}

export interface ThemeManifest {
  id: string;
  name: string;
  author?: string;
  tokens: ThemeTokens;
  notification_sound?: string;
  mascot_mode?: MascotMode;
  mascot_sprite?: MascotSpriteSpec;
}

export interface Theme {
  id: string;
  name: string;
  author?: string;
  tokens: ThemeTokens;
  mascots: Record<AgentKind, string>;
  mascotsCss: string;
  previewUrl: string;
  notificationSoundUrl?: string;
  mascotMode: MascotMode;
  mascotSpriteUrl?: string;
  mascotSprite?: MascotSpriteSpec;
}
