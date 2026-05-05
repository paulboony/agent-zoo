import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { NotificationToggle } from "./components/notification-toggle.js";
import { ThemePicker } from "./components/theme-picker.js";
import { useNotifications } from "./hooks/use-notifications.js";
import { Dashboard } from "./pages/dashboard.js";

function NotificationsBoundary() {
  useNotifications();
  return null;
}

export function App() {
  return (
    <BrowserRouter>
      <NotificationsBoundary />
      <div className="flex h-full w-full flex-col">
        <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-border border-b px-4">
          <h1 className="font-semibold">Agent Zoo</h1>
          <div className="flex items-center gap-3">
            <NotificationToggle />
            <ThemePicker />
          </div>
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
