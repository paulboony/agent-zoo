import { useEffect } from "react";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useNavigate,
} from "react-router-dom";
import {
  setNotificationNavigator,
  useNotifications,
} from "./hooks/use-notifications.js";
import { Dashboard } from "./pages/dashboard.js";

function NotificationsBoundary() {
  const navigate = useNavigate();
  useNotifications();
  useEffect(() => {
    setNotificationNavigator((to) => navigate(to));
    return () => setNotificationNavigator(null);
  }, [navigate]);
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
