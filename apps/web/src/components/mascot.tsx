import { useActiveTheme } from "@/lib-theme/context.js";
import type { AgentKind, AgentStatus } from "@agent-zoo/shared";

export type MascotState = "running" | "waiting" | "idle" | "error";

export function statusToMascotState(status: AgentStatus): MascotState {
  switch (status) {
    case "running":
      return "running";
    case "waiting_for_human":
      return "waiting";
    case "error":
      return "error";
    case "idle":
    case "ended":
      return "idle";
  }
}

interface Props {
  kind: AgentKind;
  state: MascotState;
  size?: number;
}

export function Mascot({ kind, state, size = 64 }: Props) {
  const theme = useActiveTheme();
  const svg = theme.mascots[kind] ?? "";
  return (
    <span
      className="mascot inline-block"
      role="img"
      aria-label={`${kind} agent, ${state}`}
      data-kind={kind}
      data-state={state}
      data-testid={`mascot-${kind}`}
      style={{ width: size, height: size }}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: theme-controlled, validated SVG
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
