import type { ComponentProps } from "react";
import { Toaster as SonnerToaster } from "sonner";

/**
 * App toaster. This repo has its own theme system (no next-themes), so
 * instead of detecting light/dark we style toasts with the same CSS tokens
 * the rest of the UI uses (`--popover`, `--border`, `fg`), letting them
 * track whatever theme is active.
 */
export function Toaster(props: ComponentProps<typeof SonnerToaster>) {
  return (
    <SonnerToaster
      position="bottom-right"
      toastOptions={{
        classNames: {
          toast:
            "group toast border-border bg-popover text-popover-foreground shadow-lg",
          description: "text-fg/60",
          actionButton: "bg-primary text-primary-foreground",
          cancelButton: "bg-muted text-fg/70",
        },
      }}
      {...props}
    />
  );
}
