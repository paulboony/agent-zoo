import { DashboardOverview } from "@/components/dashboard-overview.js";
import { Settings } from "@/pages/settings.js";
import { NotificationToggle } from "@/components/notification-toggle.js";
import { SessionCard } from "@/components/session-card.js";
import { SessionDetail } from "@/components/session-detail.js";
import { ThemePicker } from "@/components/theme-picker.js";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar.js";
import { Skeleton } from "@/components/ui/skeleton.js";
import { openStream } from "@/lib/api.js";
import { sortSessions, useStore } from "@/lib/store.js";
import { PawPrint, Settings as SettingsIcon } from "lucide-react";
import { useEffect, useMemo } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";

function SessionCardSkeleton() {
  return (
    <div className="flex w-full items-center gap-3 rounded-md border border-border bg-card p-3">
      <Skeleton className="size-11 shrink-0 rounded" />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <Skeleton className="h-3.5 w-2/3" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-1/2" />
      </div>
    </div>
  );
}

export function Dashboard() {
  const params = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const sessionsMap = useStore((s) => s.sessions);
  const connection = useStore((s) => s.connection);
  const selectedId = params.id ?? null;
  const selected = useStore((s) => (selectedId ? (s.sessions[selectedId] ?? null) : null));
  const sessions = useMemo(() => sortSessions(sessionsMap), [sessionsMap]);

  useEffect(() => {
    // `/stream` sends a `snapshot` SseMessage as its very first frame,
    // so we don't need a separate `/api/sessions` fetch on boot.
    const close = openStream();
    return close;
  }, []);

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" asChild>
                <Link to="/">
                  <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                    <PawPrint className="size-4" />
                  </div>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-medium">Agent Zoo</span>
                    <span className="truncate text-xs text-sidebar-foreground/60">Dashboard</span>
                  </div>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          <SidebarMenu className="gap-2 p-2">
            {sessions.length === 0 && connection === "connecting" ? (
              <>
                <SessionCardSkeleton />
                <SessionCardSkeleton />
                <SessionCardSkeleton />
              </>
            ) : sessions.length === 0 ? (
              <p className="p-4 text-center text-sidebar-foreground/50 text-xs">No sessions yet.</p>
            ) : (
              sessions.map((s) => (
                <SidebarMenuItem key={s.id}>
                  <SidebarMenuButton
                    asChild
                    isActive={s.id === selectedId}
                    tooltip={s.cwd_basename}
                    className="h-auto items-center gap-1.5 p-2"
                  >
                    <button
                      type="button"
                      data-testid={`session-card-${s.id}`}
                      data-status={s.status}
                      onClick={() => navigate(`/sessions/${s.id}`)}
                    >
                      <SessionCard session={s} />
                    </button>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))
            )}
          </SidebarMenu>
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                isActive={location.pathname === "/settings"}
                tooltip="Settings"
              >
                <button type="button" onClick={() => navigate("/settings")}>
                  <SettingsIcon />
                  <span>Settings</span>
                </button>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset className="min-w-0">
        <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-border border-b px-4">
          <SidebarTrigger />
          <div className="flex items-center gap-3">
            <NotificationToggle />
            <ThemePicker />
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-hidden">
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
