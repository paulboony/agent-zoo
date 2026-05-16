import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover.js";
import { cn } from "@/lib/cn.js";

interface Props {
  /** Full prompt text shown in the popover; also rendered inside the trigger paragraph. */
  prompt: string;
  /**
   * Tailwind classes applied to the trigger `<p>`. Each theme styles
   * its own line-clamp, cursor, hover, and focus-ring here. The base
   * `whitespace-pre-wrap break-words` styling is added automatically.
   */
  triggerClassName: string;
  /**
   * Optional decorative glyph rendered before the prompt text. Rendered
   * with `aria-hidden` + `select-none` so screen readers and
   * copy-select skip it.
   */
  prefix?: string;
  /** Popover position. Defaults match the default agent card. */
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
}

/**
 * Shared prompt-popover used by the default and theme-specific agent
 * cards. Owns the `<Popover>` + `<PopoverContent>` wrapper shape so
 * theme cards focus on what's actually theme-specific (the trigger
 * styling + the optional prefix glyph).
 */
export function PromptPopover({
  prompt,
  triggerClassName,
  prefix,
  side = "right",
  align = "start",
}: Props) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <p className={cn("whitespace-pre-wrap break-words", triggerClassName)}>
          {prefix !== undefined && (
            <span aria-hidden="true" className="mr-1 select-none">
              {prefix}
            </span>
          )}
          {prompt}
        </p>
      </PopoverTrigger>
      <PopoverContent
        side={side}
        align={align}
        className="max-h-[60vh] w-md max-w-[90vw] overflow-y-auto whitespace-pre-wrap break-words p-3 text-sm"
      >
        {prompt}
      </PopoverContent>
    </Popover>
  );
}
