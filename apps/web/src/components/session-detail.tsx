import { ScrollArea } from "@/components/ui/scroll-area.js";
import type { AgentState, SessionState } from "@agent-zoo/shared";
import { Mascot, statusToMascotState } from "./mascot.js";
import { StatusBadge } from "./status-badge.js";

function AgentNode({ agent, size }: { agent: AgentState; size: number }) {
  return (
    <div className="flex min-w-32 flex-col items-center gap-2 rounded-md border border-border bg-card p-3">
      <Mascot kind={agent.kind} state={statusToMascotState(agent.status)} size={size} />
      <div className="flex items-center gap-2">
        <span className="font-medium text-sm">{agent.kind}</span>
        <StatusBadge status={agent.status} />
      </div>
      <span className="max-w-32 truncate text-fg/50 text-xs">{agent.id}</span>
      {agent.current_tool && (
        <span className="max-w-40 truncate text-fg/70 text-xs">
          {agent.current_tool}
          {agent.current_tool_input_summary ? `: ${agent.current_tool_input_summary}` : ""}
        </span>
      )}
    </div>
  );
}

function AgentTree({ agents }: { agents: AgentState[] }) {
  if (agents.length === 0) {
    return <p className="text-fg/50 text-xs">No agents reported yet.</p>;
  }
  const main = agents.find((a) => a.id === "main") ?? agents[0];
  if (!main) {
    return <p className="text-fg/50 text-xs">No agents reported yet.</p>;
  }
  const subs = agents.filter((a) => a !== main);

  return (
    <div className="flex flex-col items-center gap-0 pt-4">
      <AgentNode agent={main} size={64} />
      {subs.length > 0 && (
        <>
          <div className="h-6 w-px bg-border" />
          <div className="flex justify-center gap-6">
            {subs.map((s, i) => {
              const showLeft = i > 0;
              const showRight = i < subs.length - 1;
              return (
                <div key={s.id} className="flex flex-col items-center">
                  <div className="relative h-6 w-full">
                    {showLeft && <div className="absolute top-0 right-1/2 left-0 h-px bg-border" />}
                    {showRight && (
                      <div className="absolute top-0 right-0 left-1/2 h-px bg-border" />
                    )}
                    <div className="-translate-x-1/2 absolute top-0 left-1/2 h-6 w-px bg-border" />
                  </div>
                  <AgentNode agent={s} size={48} />
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

export function SessionDetail({ session }: { session: SessionState }) {
  const agents = Object.values(session.agents);
  return (
    <div className="flex h-full flex-col">
      <div className="border-border border-b p-4">
        <h2 className="font-semibold text-lg">{session.cwd_basename}</h2>
        <p className="text-fg/60 text-xs">{session.cwd}</p>
        <div className="mt-2 flex items-center gap-2">
          <StatusBadge status={session.status} />
          {session.current_activity && (
            <span className="text-fg/70 text-xs">{session.current_activity}</span>
          )}
        </div>
      </div>
      <ScrollArea className="flex-1 px-4 pb-6">
        <h3 className="mt-4 font-medium text-sm">Agents</h3>
        <AgentTree agents={agents} />
      </ScrollArea>
    </div>
  );
}
