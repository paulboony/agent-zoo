import type { AgentKind } from "@agent-zoo/shared";

export type ThemeTokens = Record<string, string>;

export interface ThemeManifest {
  id: string;
  name: string;
  author?: string;
  tokens: ThemeTokens;
  notification_sound?: string;
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
}
