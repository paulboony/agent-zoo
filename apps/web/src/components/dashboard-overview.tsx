import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip.js";
import { useNow } from "@/hooks/use-now.js";
import { resolveDisplayKind } from "@/lib/agent-kind.js";
import { pickHeroAgent } from "@/lib/session-hero.js";
import { useStore } from "@/lib/store.js";
import { formatDuration } from "@/lib/time.js";
import type { SessionState } from "@agent-zoo/shared";
import { statusUrgency } from "@agent-zoo/shared";
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Mascot, statusToMascotState } from "./mascot.js";
import { StatusBadge } from "./status-badge.js";

function elapsed(iso: string, now: number): string {
  return formatDuration(now - Date.parse(iso));
}

/**
 * Build the "reason" string shown on an error-status attention row.
 * The data model exposes per-agent `error_count` but no discrete error
 * message, so we summarise by count + the most recently active erroring
 * agent's label.
 */
function errorSummary(session: SessionState): string {
  const errored = Object.values(session.agents)
    .filter((a) => a.error_count > 0)
    .sort((a, b) => Date.parse(b.last_event_at) - Date.parse(a.last_event_at));
  if (errored.length === 0) return "Errored";
  const a = errored[0];
  if (!a) return "Errored";
  const name = a.label ?? a.agent_type ?? a.id;
  const total = errored.reduce((sum, x) => sum + x.error_count, 0);
  return `${total} ${total === 1 ? "error" : "errors"} in ${name}`;
}

function attentionReason(session: SessionState): string | undefined {
  if (session.status === "waiting_for_human") return session.waiting_reason;
  if (session.status === "error") return errorSummary(session);
  return undefined;
}

function AttentionRow({ session }: { session: SessionState }) {
  const navigate = useNavigate();
  const now = useNow();
  const main = pickHeroAgent(session);
  const kind = main ? resolveDisplayKind(main) : "main";
  const reason = attentionReason(session);
  return (
    <button
      type="button"
      data-testid={`dash-attention-${session.id}`}
      onClick={() => navigate(`/sessions/${session.id}`)}
      className="flex w-full items-center gap-3 rounded-md border border-border bg-card p-3 text-left transition-colors hover:bg-muted/40"
    >
      <Mascot kind={kind} state={statusToMascotState(session.status)} size={44} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 flex-1 truncate font-medium text-sm">
            {session.cwd_basename}
          </span>
          <span className="shrink-0">
            <StatusBadge status={session.status} />
          </span>
          <span className="shrink-0 text-fg/50 text-xs">
            {elapsed(session.last_event_at, now)}
          </span>
        </div>
        {reason && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="truncate text-fg/70 text-xs">{reason}</span>
            </TooltipTrigger>
            <TooltipContent className="max-w-md break-words">{reason}</TooltipContent>
          </Tooltip>
        )}
      </div>
    </button>
  );
}

function ActiveChip({ session }: { session: SessionState }) {
  const navigate = useNavigate();
  const now = useNow();
  const main = pickHeroAgent(session);
  const kind = main ? resolveDisplayKind(main) : "main";
  return (
    <button
      type="button"
      data-testid={`dash-running-${session.id}`}
      onClick={() => navigate(`/sessions/${session.id}`)}
      className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs transition-colors hover:bg-muted/40"
    >
      <Mascot kind={kind} state="running" size={20} />
      <span className="font-medium">{session.cwd_basename}</span>
      <span className="text-fg/50">· {elapsed(session.last_event_at, now)}</span>
    </button>
  );
}

export function DashboardOverview() {
  const sessions = useStore((s) => s.sessions);
  const { attention, running } = useMemo(() => {
    const all = Object.values(sessions);
    const attention = all
      .filter((s) => s.status === "waiting_for_human" || s.status === "error")
      .sort((a, b) => {
        const ua = statusUrgency(a.status);
        const ub = statusUrgency(b.status);
        if (ua !== ub) return ub - ua;
        return Date.parse(b.last_event_at) - Date.parse(a.last_event_at);
      });
    const running = all
      .filter((s) => s.status === "running")
      .sort((a, b) => Date.parse(b.last_event_at) - Date.parse(a.last_event_at));
    return { attention, running };
  }, [sessions]);

  if (attention.length === 0 && running.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-fg/60">
        <p className="text-sm">All quiet.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      {attention.length > 0 && (
        <section data-testid="dash-attention">
          <header className="mb-2 flex items-baseline gap-2">
            <h2 className="font-semibold text-base">Needs attention</h2>
            <span className="text-fg/50 text-xs">({attention.length})</span>
          </header>
          <div className="flex flex-col gap-2">
            {attention.map((s) => (
              <AttentionRow key={s.id} session={s} />
            ))}
          </div>
        </section>
      )}
      {running.length > 0 && (
        <section data-testid="dash-running">
          <header className="mb-2 flex items-baseline gap-2">
            <h2 className="font-semibold text-base">Running</h2>
            <span className="text-fg/50 text-xs">({running.length})</span>
          </header>
          <div className="flex flex-wrap gap-2">
            {running.map((s) => (
              <ActiveChip key={s.id} session={s} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
