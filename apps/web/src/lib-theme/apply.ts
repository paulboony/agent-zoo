import type { Theme } from "./types.js";

const STYLE_ELEMENT_ID = "agent-zoo-theme-style";
const STORAGE_KEY = "dashboard.theme";

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  for (const [key, value] of Object.entries(theme.tokens)) {
    if (!key.startsWith("--")) continue;
    root.style.setProperty(key, value);
  }
  root.setAttribute("data-theme", theme.id);

  let style = document.getElementById(STYLE_ELEMENT_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement("style");
    style.id = STYLE_ELEMENT_ID;
    document.head.appendChild(style);
  }
  style.textContent = theme.mascotsCss;

  try {
    localStorage.setItem(STORAGE_KEY, theme.id);
  } catch {
    // private mode, etc.
  }
}

export function readStoredThemeId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}
