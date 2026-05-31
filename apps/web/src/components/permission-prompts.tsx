import type { PermissionSuggestion } from "@agent-zoo/shared";

const MAX = 6;

interface Props {
  fixable: number;
  needsYou: number;
  suggestions: PermissionSuggestion[];
}

export function PermissionPrompts({ fixable, needsYou, suggestions }: Props) {
  const top = suggestions.slice(0, MAX);

  return (
    <section data-testid="dash-permissions" className="rounded-lg border border-border bg-card p-4">
      <header className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="font-semibold text-sm">Permission prompts · since restart</h2>
        <span className="shrink-0 text-fg/50 text-xs">
          {fixable} fixable · {needsYou} need you
        </span>
      </header>
      {top.length === 0 ? (
        <div className="py-6 text-center text-fg/50 text-sm">No permission prompts since restart.</div>
      ) : (
        <>
          <ul className="flex flex-col gap-1.5">
            {top.map((s) => (
              <li key={s.rule} className="flex items-center gap-3">
                <code className="min-w-0 flex-1 truncate rounded bg-muted/40 px-2 py-1 font-mono text-fg/80 text-xs">
                  {s.rule}
                </code>
                <span className="shrink-0 text-fg/50 text-xs tabular-nums">×{s.count}</span>
                <button
                  type="button"
                  onClick={() => navigator.clipboard?.writeText(s.rule)}
                  className="shrink-0 rounded border border-border px-2 py-1 text-fg/70 text-xs transition-colors hover:bg-muted/40"
                >
                  Copy
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-fg/40 text-xs">
            Add to <span className="font-mono">settings.json</span> <span className="font-mono">allow</span> — review
            before applying.
          </p>
        </>
      )}
    </section>
  );
}
