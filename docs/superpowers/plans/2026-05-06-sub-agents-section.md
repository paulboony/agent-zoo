# Sub-agents Section Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the connector-line tree in `AgentTree` with a flat list under the main agent, hide ended sub-agents behind a toggle, and dim them when revealed.

**Architecture:** Server reducer now sets `status = "ended"` on `SubagentStop` (was `"idle"`) so the UI has an unambiguous filter discriminator. `AgentTree` renders the main agent on top, then a new `SubAgentSection` (local, single-use) that buckets sub-agents into active vs ended, default-hides the ended bucket behind a `Show ended (N)` button, and lays the cards out in a `flex flex-wrap` grid. Playwright happy-path test gets one extra click before its existing assertion.

**Tech Stack:** TypeScript strict · React 18 · Tailwind v4 · shadcn `Button` · Zustand store (no changes) · Playwright.

**Branch:** `feat/sub-agents-section`. Already created. Spec: `docs/superpowers/specs/2026-05-06-sub-agents-section-design.md`.

**Test cadence:** No new unit tests (project ships only one Playwright happy-path E2E per spec D7 of the parent build). Each task verifies via build + manual curl/UI smoke.

---

## File map

```
apps/
├── server/
│   └── src/
│       └── reducer.ts                          ← T1: 1-line change in SubagentStop
└── web/
    └── src/
        └── components/
            └── session-detail.tsx              ← T2: refactor AgentTree + add SubAgentSection
tests/
└── happy-path.spec.ts                          ← T3: click "Show ended" before assertion
```

No new files. No new dependencies.

---

## Task 1: Reducer — `SubagentStop` sets status = "ended"

**Goal:** A sub-agent's `status` becomes `"ended"` when `SubagentStop` fires. Aligns with `SessionEnd` (which already does this) and gives the UI a clean filter discriminator.

**Files:**
- Modify: `apps/server/src/reducer.ts:149-152`

- [ ] **Step 1.1: Apply the one-line change**

In `apps/server/src/reducer.ts`, find the `case "SubagentStop":` arm. Currently:

```ts
    case "SubagentStop":
      agent.status = "idle";
      agent.ended_at = session.last_event_at;
      break;
```

Change `"idle"` to `"ended"`:

```ts
    case "SubagentStop":
      agent.status = "ended";
      agent.ended_at = session.last_event_at;
      break;
```

- [ ] **Step 1.2: Typecheck**

Run: `pnpm --filter @agent-zoo/server typecheck`
Expected: exit 0, no output beyond the build banner.

- [ ] **Step 1.3: Smoke test the new behavior end-to-end**

Stop any running server with `pkill -f "tsx watch src/index.ts" 2>/dev/null; sleep 1`.

Start the server in the background with an empty CLAUDE_HOME (so backfill is empty):

```bash
CLAUDE_HOME=/tmp/agent-zoo-empty pnpm --filter @agent-zoo/server dev
```

Wait for `agent-zoo server listening`.

In another terminal, run `pnpm seed --scenario demo` to fire the seeded events (which include a `SubagentStart` followed by a `SubagentStop` for `alpha-reviewer-1`).

Then:

```bash
curl -s http://127.0.0.1:7777/api/sessions \
  | python3 -c "
import sys, json
d = json.load(sys.stdin)
for s in d['sessions']:
  for a in s['agents'].values():
    print(f\"{s['id']}/{a['id']} status={a['status']} ended_at={a.get('ended_at','—')}\")
"
```

Expected output includes a line for `seed-alpha/alpha-reviewer-1` with `status=ended` and `ended_at=<some-iso-string>`. `seed-alpha/main` should be `status=running`. `seed-beta/main` should be `status=waiting_for_human`.

Stop the server: `pkill -f "tsx watch src/index.ts" 2>/dev/null`.

- [ ] **Step 1.4: Lint**

Run: `pnpm lint`
Expected: exit 0.

- [ ] **Step 1.5: Commit**

```bash
git add apps/server/src/reducer.ts
git commit -m "fix(server): SubagentStop sets agent status to 'ended' (was 'idle')"
```

---

## Task 2: Web — `SubAgentSection` + `AgentTree` refactor

**Goal:** `AgentTree` renders the main agent on top, then `<SubAgentSection subs={subs} />` if any sub-agents exist. The new component groups sub-agents into active and ended buckets, default-hides ended behind a `Show ended (N)` button, and dims revealed ended cards at 50% opacity. All connector-line markup is dropped.

**Files:**
- Modify: `apps/web/src/components/session-detail.tsx`

- [ ] **Step 2.1: Read the current file in full**

Run: `cat apps/web/src/components/session-detail.tsx | head -90`

Confirm the current structure:
- `AgentNode` renders a single `<Card>` with mascot + badges
- `AgentTree` renders main + connector divs + per-sub flex-col with absolute-positioned line dividers + `<AgentNode size={48} />` for each
- `SessionDetail` wraps `AgentTree` in `<h3>Agents</h3>` + `<ScrollArea>`

- [ ] **Step 2.2: Update imports**

In `apps/web/src/components/session-detail.tsx`, the imports section starts:

```ts
import { Badge } from "@/components/ui/badge.js";
import { Card } from "@/components/ui/card.js";
import { ScrollArea } from "@/components/ui/scroll-area.js";
import { Separator } from "@/components/ui/separator.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip.js";
import type { AgentState, SessionState } from "@agent-zoo/shared";
import { Clock, Code, Cpu } from "lucide-react";
import { Mascot, statusToMascotState } from "./mascot.js";
import { StatusBadge } from "./status-badge.js";
```

Change to:

```ts
import { Badge } from "@/components/ui/badge.js";
import { Button } from "@/components/ui/button.js";
import { Card } from "@/components/ui/card.js";
import { ScrollArea } from "@/components/ui/scroll-area.js";
import { Separator } from "@/components/ui/separator.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip.js";
import type { AgentState, SessionState } from "@agent-zoo/shared";
import { statusUrgency } from "@agent-zoo/shared";
import { Clock, Code, Cpu } from "lucide-react";
import { useState } from "react";
import { Mascot, statusToMascotState } from "./mascot.js";
import { StatusBadge } from "./status-badge.js";
```

Two new imports added: `Button`, `statusUrgency`, `useState`.

- [ ] **Step 2.3: Replace the `AgentTree` function**

Find the existing `AgentTree` function (after `AgentNode`, before `SessionDetail`). Replace its **entire body** (everything from `function AgentTree` to its closing `}`) with:

```tsx
function SubAgentSection({ subs }: { subs: AgentState[] }) {
  const [showEnded, setShowEnded] = useState(false);

  const active = subs
    .filter((s) => s.status !== "ended")
    .sort((a, b) => {
      const ua = statusUrgency(a.status);
      const ub = statusUrgency(b.status);
      if (ua !== ub) return ub - ua;
      return Date.parse(b.last_event_at) - Date.parse(a.last_event_at);
    });

  const ended = subs
    .filter((s) => s.status === "ended")
    .sort((a, b) => {
      const aTs = a.ended_at ?? a.last_event_at;
      const bTs = b.ended_at ?? b.last_event_at;
      return Date.parse(bTs) - Date.parse(aTs);
    });

  return (
    <div className="mt-6 w-full">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-medium text-sm">Sub-agents ({active.length})</h3>
        {ended.length > 0 && (
          <Button variant="ghost" size="sm" onClick={() => setShowEnded((v) => !v)}>
            {showEnded ? "Hide ended" : `Show ended (${ended.length})`}
          </Button>
        )}
      </div>
      <div className="flex flex-wrap justify-center gap-3">
        {active.map((s) => (
          <AgentNode key={s.id} agent={s} size={48} />
        ))}
        {showEnded &&
          ended.map((s) => (
            <div key={s.id} className="opacity-50">
              <AgentNode agent={s} size={48} />
            </div>
          ))}
      </div>
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
    <div className="flex flex-col items-center pt-4">
      <AgentNode agent={main} size={64} />
      {subs.length > 0 && <SubAgentSection subs={subs} />}
    </div>
  );
}
```

Notes on what changed vs before:
- All connector-line divs removed (the `<div className="h-6 w-px bg-border" />` trunk and the per-sub absolute-positioned lines).
- Sub-agents now go through `SubAgentSection`.
- Active vs ended filter is by `s.status === "ended"` — this is why Task 1's reducer change matters.

- [ ] **Step 2.4: Typecheck**

Run: `pnpm --filter @agent-zoo/web typecheck`
Expected: exit 0.

- [ ] **Step 2.5: Lint**

Run: `pnpm lint`
Expected: exit 0. If biome's `organizeImports` complains, run `pnpm lint:fix` and re-run `pnpm lint`.

- [ ] **Step 2.6: Build**

Run: `pnpm --filter @agent-zoo/web build`
Expected: Vite reports a successful build (`✓ built in <Xms>`), and `apps/web/dist/` is regenerated.

- [ ] **Step 2.7: Manual smoke**

Start the full stack with empty CLAUDE_HOME (so demo data is the only thing in the dashboard):

```bash
CLAUDE_HOME=/tmp/agent-zoo-empty pnpm --filter @agent-zoo/server dev
```
(Run in the background.)

```bash
pnpm --filter @agent-zoo/web dev
```
(Run in the background.)

Wait for both to be ready, then:

```bash
pnpm seed --scenario demo
```

Open http://localhost:5173 in a browser. Click `seed-alpha` in the sidebar.

Expected layout:
- `main` agent card on top (size 64).
- A section header below: `Sub-agents (0)` and a `Show ended (1)` button on the right (since `alpha-reviewer-1` is now `status="ended"` after the seed's `SubagentStop`).
- No sub-agent cards visible by default.

Click `Show ended (1)` → button label flips to `Hide ended` → an `alpha-reviewer-1` card appears at 50% opacity.

Click `seed-beta` in the sidebar:
- `main` card on top.
- No `Sub-agents` section at all (beta has no sub-agents).

Resize the browser between ~600px and ~1500px while viewing `seed-alpha` with ended visible. The single sub-agent card should remain visible without any broken connector artifacts (because there are none).

Stop the dev servers: `pkill -f "tsx watch src/index.ts" 2>/dev/null; pkill -f "vite" 2>/dev/null`.

- [ ] **Step 2.8: Commit**

```bash
git add apps/web/src/components/session-detail.tsx
git commit -m "feat(web): replace tree connectors with SubAgentSection (default-hide ended)"
```

---

## Task 3: Playwright — click "Show ended" before asserting `alpha-reviewer-1`

**Goal:** The existing happy-path test asserts `alpha-reviewer-1` is visible after selecting `seed-alpha`. With Task 1's reducer change, `alpha-reviewer-1` ends with `status="ended"` and is hidden by default. Add one click on the `Show ended` button before the assertion.

**Files:**
- Modify: `tests/happy-path.spec.ts`

- [ ] **Step 3.1: Read the current spec**

Run: `cat tests/happy-path.spec.ts`

Locate the block:

```ts
    // selecting alpha opens the detail pane with the agent tree
    await alphaCard.click();
    await expect(page).toHaveURL(/\/sessions\/seed-alpha$/);
    await expect(page.getByText("alpha-reviewer-1")).toBeVisible();
```

- [ ] **Step 3.2: Insert a click on the "Show ended" button**

Replace the block above with:

```ts
    // selecting alpha opens the detail pane with the agent tree
    await alphaCard.click();
    await expect(page).toHaveURL(/\/sessions\/seed-alpha$/);

    // alpha-reviewer-1 ended via SubagentStop and is hidden by default;
    // reveal it via the toggle before asserting visibility.
    await page.getByRole("button", { name: /show ended/i }).click();
    await expect(page.getByText("alpha-reviewer-1")).toBeVisible();
```

- [ ] **Step 3.3: Lint**

Run: `pnpm lint`
Expected: exit 0.

- [ ] **Step 3.4: Run the test**

Run: `pnpm test`
Expected: Playwright spins up server + web, runs the seed, executes the spec, prints `1 passed`. Final exit 0.

If the test fails:
- Check the trace under `playwright-report/` or `test-results/`.
- Common issue: button label mismatch — the regex `/show ended/i` should match `Show ended (1)`. If it doesn't, adjust to `getByRole("button", { name: /show ended \(\d+\)/i })`.

- [ ] **Step 3.5: Commit**

```bash
git add tests/happy-path.spec.ts
git commit -m "test: reveal ended sub-agents before asserting alpha-reviewer-1 visible"
```

---

## Task 4: Final pipeline check

**Goal:** Confirm the whole project is green end-to-end on `feat/sub-agents-section`.

**Files:** none.

- [ ] **Step 4.1: Lint**

Run: `pnpm lint`
Expected: exit 0.

- [ ] **Step 4.2: Typecheck across workspaces**

Run: `pnpm typecheck`
Expected: turbo runs typecheck for `@agent-zoo/shared`, `@agent-zoo/server`, `@agent-zoo/web`. All exit 0.

- [ ] **Step 4.3: Web build**

Run: `pnpm --filter @agent-zoo/web build`
Expected: Vite emits `apps/web/dist/`. Exit 0.

- [ ] **Step 4.4: Playwright**

Run: `pnpm test`
Expected: `1 passed`. Exit 0.

- [ ] **Step 4.5: Verify the branch state**

Run: `git log --oneline master..HEAD`
Expected: 4 commits unique to `feat/sub-agents-section`:
1. `docs: add sub-agents-section design spec`
2. `docs: align spec with reducer ('ended' status) and test impact`
3. `fix(server): SubagentStop sets agent status to 'ended' (was 'idle')`
4. `feat(web): replace tree connectors with SubAgentSection (default-hide ended)`
5. `test: reveal ended sub-agents before asserting alpha-reviewer-1 visible`

(Counted from the spec commits onward; if you only count the implementation commits, it's 3.)

Run: `git status`
Expected: clean except for the untracked `CLAUDE.md`, `README.md`, `docs/01-*.md` etc. (pre-existing, not part of git).

---

## Self-review

**1. Spec coverage:**

| Spec section | Plan task |
| --- | --- |
| §3 D1 Layout: flat list under main | T2 (AgentTree refactor) |
| §3 D2 Wrapping: flex-wrap | T2 (`flex flex-wrap gap-3`) |
| §3 D3 Hide ended by default + toggle + reducer alignment | T1 (reducer) + T2 (SubAgentSection toggle) |
| §3 D4 Dim ended at 50% | T2 (`<div className="opacity-50">`) |
| §3 D5 Sort order (urgency desc / ended_at desc) | T2 (sort comparators in SubAgentSection) |
| §6 Files & deps | T1, T2, T3 |
| §7 Edge cases (0 subs, all ended, single sub) | T2 conditional render handles all three |
| §8 Verification — Playwright update | T3 |
| §8 Lint/typecheck/build green | T4 |
| §10 Risks — `showEnded` is local state | Acknowledged in spec; intentional |

No gaps.

**2. Placeholder scan:** Searched for `TBD`, `TODO`, `Similar to Task`, `appropriate error handling`. None present. Every code change is fully specified inline.

**3. Type consistency:**
- `AgentState`, `SessionState` from `@agent-zoo/shared` — referenced consistently.
- `statusUrgency` import added in T2 step 2.2 and used in step 2.3 sort comparator. Consistent.
- `useState` import added in T2 step 2.2 and used in `SubAgentSection`. Consistent.
- `Button` import added in T2 step 2.2 and used in `SubAgentSection`. Consistent.
- T1's `status = "ended"` assignment matches T2's `s.status === "ended"` filter exactly.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-06-sub-agents-section.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration with isolated context per step.

**2. Inline Execution** — Execute tasks in this session using `executing-plans`, batched with checkpoints for review.

Which approach?
