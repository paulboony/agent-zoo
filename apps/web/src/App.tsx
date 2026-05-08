import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
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
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/sessions/:id" element={<Dashboard />} />
        <Route path="/settings" element={<Dashboard />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
