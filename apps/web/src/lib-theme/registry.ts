import type { AgentKind } from "@agent-zoo/shared";
import type { Theme, ThemeManifest } from "./types.js";

type EagerStringRecord = Record<string, string>;

const manifests = import.meta.glob<{ default: ThemeManifest }>("../themes/*/theme.json", {
  eager: true,
});
const cssModules = import.meta.glob("../themes/*/mascots.css", {
  eager: true,
  query: "?inline",
  import: "default",
}) as EagerStringRecord;
const previewModules = import.meta.glob("../themes/*/preview.png", {
  eager: true,
  query: "?url",
  import: "default",
}) as EagerStringRecord;
const mascotModules = import.meta.glob("../themes/*/mascots/*.svg", {
  eager: true,
  query: "?raw",
  import: "default",
}) as EagerStringRecord;
const spriteModules = import.meta.glob("../themes/*/mascots/sprites.png", {
  eager: true,
  query: "?url",
  import: "default",
}) as EagerStringRecord;
const soundModules = import.meta.glob("../themes/*/notification.mp3", {
  eager: true,
  query: "?url",
  import: "default",
}) as EagerStringRecord;

const KIND_FILES: Record<AgentKind, string> = {
  main: "main.svg",
  "code-reviewer": "code-reviewer.svg",
  explorer: "explorer.svg",
  writer: "writer.svg",
  coder: "coder.svg",
  general: "general.svg",
};

function buildRegistry(): Record<string, Theme> {
  const themes: Record<string, Theme> = {};

  for (const [manifestPath, mod] of Object.entries(manifests)) {
    const manifest = mod.default;
    const themeId = manifest.id;
    const folder = manifestPath.replace(/\/theme\.json$/, "");

    const cssKey = `${folder}/mascots.css`;
    const previewKey = `${folder}/preview.png`;
    const soundKey = `${folder}/notification.mp3`;
    const spriteKey = `${folder}/mascots/sprites.png`;

    const mascots = {} as Record<AgentKind, string>;
    for (const kind of Object.keys(KIND_FILES) as AgentKind[]) {
      const svgKey = `${folder}/mascots/${KIND_FILES[kind]}`;
      mascots[kind] = mascotModules[svgKey] ?? "";
    }

    const theme: Theme = {
      id: themeId,
      name: manifest.name,
      tokens: manifest.tokens,
      mascots,
      mascotsCss: cssModules[cssKey] ?? "",
      previewUrl: previewModules[previewKey] ?? "",
      mascotMode: manifest.mascot_mode ?? "svg",
    };
    if (manifest.author !== undefined) theme.author = manifest.author;
    if (soundModules[soundKey] !== undefined) theme.notificationSoundUrl = soundModules[soundKey];
    if (manifest.mascot_sprite !== undefined) theme.mascotSprite = manifest.mascot_sprite;
    if (spriteModules[spriteKey] !== undefined) theme.mascotSpriteUrl = spriteModules[spriteKey];

    themes[themeId] = theme;
  }

  return themes;
}

export const themes: Record<string, Theme> = buildRegistry();
export const themeIds = Object.keys(themes);
export const defaultThemeId = "default";
