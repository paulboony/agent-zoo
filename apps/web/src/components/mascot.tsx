import { useActiveTheme } from "@/lib-theme/context.js";
import type { Theme } from "@/lib-theme/types.js";
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
  if (theme.mascotMode === "sprite" && theme.mascotSpriteUrl && theme.mascotSprite) {
    return <SpriteMascot theme={theme} kind={kind} state={state} size={size} />;
  }
  return <SvgMascot theme={theme} kind={kind} state={state} size={size} />;
}

function SvgMascot({
  theme,
  kind,
  state,
  size,
}: {
  theme: Theme;
  kind: AgentKind;
  state: MascotState;
  size: number;
}) {
  const svg = theme.mascots[kind] ?? "";
  return (
    <span
      className="mascot inline-block"
      role="img"
      aria-label={`${kind} agent, ${state}`}
      data-kind={kind}
      data-state={state}
      data-render="svg"
      data-testid={`mascot-${kind}`}
      style={{ width: size, height: size }}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: theme-controlled, validated SVG
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

function SpriteMascot({
  theme,
  kind,
  state,
  size,
}: {
  theme: Theme;
  kind: AgentKind;
  state: MascotState;
  size: number;
}) {
  const spec = theme.mascotSprite;
  const url = theme.mascotSpriteUrl;
  if (!spec || !url) return null;
  const stateRange = spec.states[state];

  const cellW = spec.cell.width;
  const cellH = spec.cell.height;
  const gapX = spec.gap?.x ?? 0;
  const gapY = spec.gap?.y ?? 0;
  const padX = spec.padding?.x ?? 0;
  const padY = spec.padding?.y ?? 0;
  const strideX = cellW + gapX;
  const strideY = cellH + gapY;

  const scale = size / cellH;
  const wrapperW = cellW * scale;
  const wrapperH = size;

  const row = spec.rows[kind] ?? 0;
  const frames =
    "frames" in stateRange && stateRange.frames !== undefined
      ? stateRange.frames
      : Array.from({ length: stateRange.count ?? 1 }, (_, i) => (stateRange.start ?? 0) + i);
  const animate = frames.length > 1;
  const fps = stateRange.fps ?? 8;
  const dur = animate ? `${frames.length / fps}s` : "0s";

  const frameVars: Record<string, number | string> = {};
  frames.forEach((col, i) => {
    frameVars[`--frame-${i}`] = col;
  });

  return (
    <span
      className="mascot inline-block"
      role="img"
      aria-label={`${kind} agent, ${state}`}
      data-kind={kind}
      data-state={state}
      data-render="sprite"
      data-testid={`mascot-${kind}`}
      style={{
        width: wrapperW,
        height: wrapperH,
        overflow: "hidden",
      }}
    >
      <span
        className="mascot-sprite"
        data-animate={animate ? frames.length : undefined}
        style={
          {
            display: "block",
            width: cellW,
            height: cellH,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
            backgroundImage: `url(${url})`,
            backgroundRepeat: "no-repeat",
            imageRendering: "pixelated",
            "--row": row,
            "--stride-x": `${strideX}px`,
            "--stride-y": `${strideY}px`,
            "--pad-x": `${padX}px`,
            "--pad-y": `${padY}px`,
            "--dur": dur,
            ...frameVars,
          } as React.CSSProperties
        }
      />
    </span>
  );
}
