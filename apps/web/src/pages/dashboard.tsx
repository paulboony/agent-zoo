import { AppSidebar } from "@/components/app-sidebar.js";
import { DashboardOverview } from "@/components/dashboard-overview.js";
import { NotificationToggle } from "@/components/notification-toggle.js";
import { SessionDetail } from "@/components/session-detail.js";
import { ThemePicker } from "@/components/theme-picker.js";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar.js";
import { openStream } from "@/lib/api.js";
import { useStore } from "@/lib/store.js";
import { useEffect } from "react";
import { useLocation, useParams } from "react-router-dom";
import { Settings } from "@/pages/settings.js";

export function Dashboard() {
  const params = useParams<{ id?: string }>();
  const location = useLocation();
  const selectedId = params.id ?? null;
  const selected = useStore((s) => (selectedId ? (s.sessions[selectedId] ?? null) : null));

  useEffect(() => {
    // `/stream` sends a `snapshot` SseMessage as its very first frame,
    // so we don't need a separate `/api/sessions` fetch on boot.
    const close = openStream();
    return close;
  }, []);

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="min-w-0">
        <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-border border-b px-4">
          <SidebarTrigger />
          <div className="flex items-center gap-3">
            <NotificationToggle />
            <ThemePicker />
          </div>
        </header>
        <div className="theme-content min-h-0 flex-1 overflow-hidden">
          {location.pathname === "/settings" ? (
            <Settings />
          ) : selected ? (
            <SessionDetail session={selected} />
          ) : (
            <DashboardOverview />
          )}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
