import { SessionCard } from "@/components/session-card.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.js";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar.js";
import { Skeleton } from "@/components/ui/skeleton.js";
import { sortSessions, useStore } from "@/lib/store.js";
import { ListFilter, PawPrint, Settings as SettingsIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";

type SessionFilter = "all" | "active" | "ended";

const FILTER_LABELS: Record<SessionFilter, string> = {
  all: "All",
  active: "Active",
  ended: "Ended",
};

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

export function AppSidebar() {
  const params = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const sessionsMap = useStore((s) => s.sessions);
  const connection = useStore((s) => s.connection);
  const selectedId = params.id ?? null;
  const [filter, setFilter] = useState<SessionFilter>("all");
  const sessions = useMemo(() => {
    const sorted = sortSessions(sessionsMap);
    if (filter === "active") return sorted.filter((s) => s.status !== "ended");
    if (filter === "ended") return sorted.filter((s) => s.status === "ended");
    return sorted;
  }, [sessionsMap, filter]);

  return (
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
        <SidebarGroup>
          <SidebarGroupLabel>Sessions</SidebarGroupLabel>
          <DropdownMenu>
            <SidebarGroupAction asChild title={`Filter: ${FILTER_LABELS[filter]}`}>
              <DropdownMenuTrigger>
                <ListFilter />
                <span className="sr-only">Filter sessions</span>
              </DropdownMenuTrigger>
            </SidebarGroupAction>
            <DropdownMenuContent side="right" align="start">
              <DropdownMenuLabel className="text-xs text-muted-foreground">Show</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={filter}
                onValueChange={(v) => setFilter(v as SessionFilter)}
              >
                <DropdownMenuRadioItem value="all">All</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="active">Active</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="ended">Ended</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <SidebarGroupContent>
            <SidebarMenu className="gap-2 p-2">
              {sessions.length === 0 && connection === "connecting" ? (
                <>
                  <SessionCardSkeleton />
                  <SessionCardSkeleton />
                  <SessionCardSkeleton />
                </>
              ) : sessions.length === 0 ? (
                <p className="p-4 text-center text-sidebar-foreground/50 text-xs">
                  No sessions yet.
                </p>
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
          </SidebarGroupContent>
        </SidebarGroup>
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
  );
}
