import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { applyTheme, readStoredThemeId } from "./apply.js";
import { defaultThemeId, themes } from "./registry.js";
import type { Theme } from "./types.js";

interface ThemeContextValue {
  active: Theme;
  setThemeId: (id: string) => void;
  available: Theme[];
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function pickInitialThemeId(): string {
  const stored = readStoredThemeId();
  if (stored && themes[stored]) return stored;
  if (themes[defaultThemeId]) return defaultThemeId;
  const first = Object.keys(themes)[0];
  if (!first) throw new Error("no themes registered");
  return first;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [activeId, setActiveId] = useState<string>(() => pickInitialThemeId());

  useEffect(() => {
    const theme = themes[activeId];
    if (theme) applyTheme(theme);
  }, [activeId]);

  const setThemeId = useCallback((id: string) => {
    if (themes[id]) setActiveId(id);
  }, []);

  const value = useMemo<ThemeContextValue>(() => {
    const active = themes[activeId];
    if (!active) throw new Error(`theme "${activeId}" not registered`);
    return {
      active,
      setThemeId,
      available: Object.values(themes),
    };
  }, [activeId, setThemeId]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useActiveTheme(): Theme {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useActiveTheme outside ThemeProvider");
  return ctx.active;
}

export function useThemeControls(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useThemeControls outside ThemeProvider");
  return ctx;
}
