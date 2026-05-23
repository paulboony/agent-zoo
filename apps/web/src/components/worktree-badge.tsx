import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip.js";
import { GitBranch } from "lucide-react";
import type { SessionState } from "@agent-zoo/shared";

interface Props {
  session: SessionState;
  /** Render the label after the icon. Skip for chip-style usage. */
  withLabel?: boolean;
}

/**
 * Renders nothing unless the session's `cwd` was detected as a git
 * worktree (linked checkout, not the main one). Server-side detection
 * runs once per session via `git rev-parse --git-dir/--git-common-dir`.
 *
 * Tooltip shows the main checkout path so the user knows which repo
 * the worktree belongs to.
 */
export function WorktreeBadge({ session, withLabel = false }: Props) {
  if (!session.is_worktree) return null;
  const main = session.worktree_main_path;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          data-testid={`worktree-badge-${session.id}`}
          className="inline-flex shrink-0 items-center gap-1 rounded-sm bg-muted px-1.5 py-0.5 font-medium text-[10px] text-fg/70 uppercase tracking-wider"
        >
          <GitBranch className="size-3" />
          {withLabel && <span>worktree</span>}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-md break-all">
        {main ? <>Worktree of <span className="font-mono">{main}</span></> : "Linked git worktree"}
      </TooltipContent>
    </Tooltip>
  );
}
