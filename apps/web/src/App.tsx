import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { ThemePicker } from "./components/theme-picker.js";
import { Dashboard } from "./pages/dashboard.js";

export function App() {
  return (
    <BrowserRouter>
      <div className="flex h-full w-full flex-col">
        <header className="flex h-12 shrink-0 items-center justify-between border-border border-b px-4">
          <h1 className="font-semibold">Agent Zoo</h1>
          <ThemePicker />
        </header>
        <main className="flex-1 overflow-hidden">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/sessions/:id" element={<Dashboard />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
