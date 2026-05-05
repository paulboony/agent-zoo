import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { ThemeProvider } from "./lib-theme/context.js";
import { themes } from "./lib-theme/registry.js";
import { validateThemes } from "./lib-theme/validate.js";
import "./main.css";

if (import.meta.env.DEV) {
  const issues = validateThemes(themes);
  if (issues.length > 0) {
    for (const issue of issues) {
      console.error(`[theme-validation] ${issue.themeId}: ${issue.message}`);
    }
  }
}

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");

if (Object.keys(themes).length === 0) {
  root.innerHTML =
    '<div style="padding:24px;font-family:sans-serif">No themes registered yet. Add one under apps/web/src/themes/.</div>';
} else {
  createRoot(root).render(
    <StrictMode>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </StrictMode>,
  );
}
