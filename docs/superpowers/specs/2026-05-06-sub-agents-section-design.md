# Sub-agents Section — Design (2026-05-06)

Branch: `feat/sub-agents-section`. Replaces the connector-line tree in
`AgentTree` with a flat, resize-resilient list of sub-agent cards underneath
the main agent.

## 1. Problem

`AgentTree` in `apps/web/src/components/session-detail.tsx` renders the main
agent on top with sub-agents below, joined by CSS-only elbow connectors built
from absolutely-positioned `<div>`s with half-width borders. The connectors
break when sub-agents wrap to a second row (the cross-row segment doesn't
exist) and the layout looks fragile on browser resize. Sub-agents that have
already ended also accumulate, cluttering the section over time.

## 2. Goal

Replace the connector-based layout with a wrapping flat-list under the main
agent, hide ended sub-agents behind a toggle, and dim them when revealed. Pure
UI refactor — no protocol, store, or shared-types changes.

## 3. Decisions

### D1 — Layout: flat list under main, no connector lines

Main agent card sits on top. If sub-agents exist, a `SubAgentSection` renders
underneath: a section header followed by a wrap-grid of `<AgentNode />` cards
(reused unchanged). No connector lines between main and subs — section
grouping conveys the relationship.

### D2 — Wrapping: flex-wrap to multiple rows

Sub-agent cards use `flex flex-wrap gap-3` so they flow onto extra rows when
the container narrows. No horizontal scroll, no responsive stack — just
natural wrap.

### D3 — Ended sub-agents: hidden by default; toggle reveals them

Sub-agents with `status === "ended"` are omitted from the default view.
A shadcn `Button` (variant=`ghost`, size=`sm`) labelled `Show ended (N)`
appears in the section header when `ended.length > 0`. Clicking toggles to
`Hide ended` and the ended cards become visible.

### D4 — Revealed ended cards are dimmed

When the toggle is on, ended cards render with `opacity-50` (no other style
changes; the existing `StatusBadge` already says `ended`). They render after
all active cards in the same wrap-grid.

### D5 — Sort order

- Active sub-agents: by `statusUrgency` descending (`error` > `waiting_for_human`
  > `running` > `idle`), ties broken by `last_event_at` descending.
- Ended sub-agents: by `ended_at` descending (most recently finished first),
  fallback to `last_event_at` if `ended_at` is missing.

`statusUrgency` is already exported from `@agent-zoo/shared`.

## 4. Component tree

```
AgentTree (renamed responsibility, same export name)
├── AgentNode  agent={main}  size={64}
└── SubAgentSection  subs={subs}            ← only when subs.length > 0
    ├── Header
    │    ├── <h3>  Sub-agents ({active.length})
    │    └── <Button>  Show ended (N)        ← only when ended.length > 0
    └── Grid (flex flex-wrap gap-3)
         ├── AgentNode  agent={a}  size={48}    ← for each active sub
         └── div(opacity-50) > AgentNode ...    ← for each ended sub, only when showEnded
```

`SubAgentSection` is a new component **local to `session-detail.tsx`** — not
exported, single use site, ~40 lines including header and toggle wiring. State
lives in `useState<boolean>` inside the component; no store changes.

## 5. Implementation outline

Single file: `apps/web/src/components/session-detail.tsx`.

1. Drop the connector-line markup from `AgentTree` (the trunk div, the per-sub
   `relative h-6 w-full` wrapper, the absolute half-line/v-line divs).
2. Replace it with `<SubAgentSection subs={subs} />`.
3. Add `SubAgentSection` (local function component):
   - Imports needed: `useState` from `react`; `Button` from `@/components/ui/button.js`;
     `statusUrgency` from `@agent-zoo/shared`.
   - Splits subs into active/ended.
   - Sorts each group per D5.
   - Renders header + grid as in §4.
4. No styling changes to `AgentNode` itself.

## 6. Files & dependencies

- **Modify:** `apps/web/src/components/session-detail.tsx`
- **No new files.**
- **No new dependencies.**
- **No CSS changes** beyond Tailwind class swaps in the same file.

## 7. Edge cases

| Case | Behavior |
| --- | --- |
| 0 sub-agents | `SubAgentSection` not rendered. |
| 0 active, N ended | Header shows `Sub-agents (0)` + toggle. Default body empty. |
| All ended hidden | Body is `<div className="..."/>` with no children — fine. |
| Single sub-agent (active or ended) | Same path; single card in grid. |
| Resize narrow | Cards wrap, no broken lines. |

## 8. Verification

- **Playwright happy-path** (`tests/happy-path.spec.ts`) currently asserts
  that selecting `seed-alpha` shows the text `alpha-reviewer-1` in the detail
  pane. The new layout still renders that sub-agent card by default
  (`alpha-reviewer-1` is `idle`, not `ended`, after the seed scenario), so the
  test continues to pass without modification.
- **Manual smoke**: resize the browser between ~600px and ~1500px while
  viewing a session with multiple sub-agents; cards should wrap cleanly. No
  connector lines means nothing to break.
- **Lint/typecheck/build** must remain green: `pnpm lint`,
  `pnpm --filter @agent-zoo/web typecheck`, `pnpm --filter @agent-zoo/web build`.

## 9. Out of scope

- Connector lines back to main agent — abandoned (was the source of the
  resize fragility).
- Sub-sub-agent nesting — `AgentState` does not carry a parent reference;
  store changes would be required to support deeper trees. Not in v1.
- Click-to-focus a sub-agent — sub-agents have no detail surface today.
- Per-card actions (kill / retry / open log) — dashboard is read-only by
  spec (`docs/08-scope.md`).
- Filter chips (e.g. status filters) on the sub-agent list — only the
  ended-vs-active split is in v1.

## 10. Risks

- **None protocol-level.** Pure UI refactor in one file.
- **Visual risk:** loss of the explicit parent-child arrow may make the
  relationship slightly less obvious. Mitigation: section heading
  `Sub-agents (N)` is unambiguous; main agent is visually larger
  (size=64 vs 48).
- **State persistence:** `showEnded` is per-render local state — toggling a
  session's view, navigating away, and returning will reset the toggle. Acceptable
  for v1; could move to a per-session map in the store later if desired.

## 11. Handoff

Once approved, the next step is the `writing-plans` skill to produce a
step-by-step implementation plan from this spec.
