import { EmptyState } from "@/components/empty-state.js";
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
import { fetchSnapshot, openStream } from "@/lib/api.js";
import { sortSessions, useStore } from "@/lib/store.js";
import { Monitor, Settings as SettingsIcon } from "lucide-react";
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
    fetchSnapshot().catch((err) => console.warn("snapshot failed", err));
    const close = openStream();
    return close;
  }, []);

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <Link
            to="/"
            className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          >
            <Monitor className="size-4 shrink-0" />
            <h1 className="font-semibold group-data-[collapsible=icon]:hidden">Agent Zoo</h1>
          </Link>
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
                    className="h-auto items-center gap-3 p-3"
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
      <SidebarInset>
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
            <EmptyState message="Select a session on the left." />
          )}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
