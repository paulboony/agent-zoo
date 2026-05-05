import { ScrollArea } from "@/components/ui/scroll-area.js";
import type { AgentState, SessionState } from "@agent-zoo/shared";
import { Mascot, statusToMascotState } from "./mascot.js";
import { StatusBadge } from "./status-badge.js";

function AgentRow({ agent }: { agent: AgentState }) {
  return (
    <div className="flex items-center gap-3 border-border/60 border-b py-2 last:border-b-0">
      <Mascot kind={agent.kind} state={statusToMascotState(agent.status)} size={40} />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">{agent.kind}</span>
          <span className="text-fg/50 text-xs">({agent.id})</span>
          <StatusBadge status={agent.status} />
        </div>
        {agent.current_tool && (
          <span className="truncate text-fg/70 text-xs">
            {agent.current_tool}
            {agent.current_tool_input_summary ? `: ${agent.current_tool_input_summary}` : ""}
          </span>
        )}
      </div>
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
      <ScrollArea className="flex-1 px-4">
        <h3 className="mt-4 font-medium text-sm">Agents</h3>
        <div className="mt-2">
          {agents.length === 0 ? (
            <p className="text-fg/50 text-xs">No agents reported yet.</p>
          ) : (
            agents.map((a) => <AgentRow key={a.id} agent={a} />)
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
