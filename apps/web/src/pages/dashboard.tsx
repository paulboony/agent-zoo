import { EmptyState } from "@/components/empty-state.js";
import { SessionCard } from "@/components/session-card.js";
import { SessionDetail } from "@/components/session-detail.js";
import { ScrollArea } from "@/components/ui/scroll-area.js";
import { fetchSnapshot, openStream } from "@/lib/api.js";
import { sortSessions, useStore } from "@/lib/store.js";
import { useEffect, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";

export function Dashboard() {
  const params = useParams<{ id?: string }>();
  const navigate = useNavigate();
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
    <div className="flex h-full">
      <aside className="flex w-80 shrink-0 flex-col border-border border-r">
        <div className="flex h-10 items-center justify-between border-border border-b px-3 text-fg/70 text-xs">
          <span>Sessions ({sessions.length})</span>
          <span data-testid="connection-state">{connection}</span>
        </div>
        <ScrollArea className="flex-1">
          <div className="flex flex-col gap-2 p-2">
            {sessions.length === 0 ? (
              <p className="p-4 text-center text-fg/50 text-xs">No sessions yet.</p>
            ) : (
              sessions.map((s) => (
                <SessionCard
                  key={s.id}
                  session={s}
                  selected={s.id === selectedId}
                  onSelect={() => navigate(`/sessions/${s.id}`)}
                />
              ))
            )}
          </div>
        </ScrollArea>
      </aside>
      <section className="flex-1">
        {selected ? (
          <SessionDetail session={selected} />
        ) : (
          <EmptyState message="Select a session on the left." />
        )}
      </section>
    </div>
  );
}
