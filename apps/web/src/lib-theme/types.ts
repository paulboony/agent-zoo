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

export interface SpritePadding {
  /** px from the left edge of the image to the first column. */
  x?: number;
  /** px from the top edge of the image to the first row. */
  y?: number;
}

/**
 * Frames for one mascot state. Columns to cycle through, in order.
 * A single-element array is static (no animation).
 *
 *   { frames: [0] }              // static col 0
 *   { frames: [0, 1] }           // 2-frame walk
 *   { frames: [0, 3] }           // non-contiguous
 */
export interface SpriteStateRange {
  frames: number[];
  /** Animation speed when more than one frame. Defaults to 8. */
  fps?: number;
}

export interface MascotSpriteSpec {
  cell: SpriteCell;
  gap?: SpriteGap;
  /** Offset from the top-left corner of the image to the first cell. Defaults to 0,0. */
  padding?: SpritePadding;
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
