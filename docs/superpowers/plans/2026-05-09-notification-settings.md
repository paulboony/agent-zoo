# Notification Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/settings` route with a Notifications section that lets the user toggle browser notifications per session-event type (start, error, complete, waiting-for-human, subagent spawn), and add a Settings button in the sidebar footer.

**Architecture:** Pure client-side React/Zustand changes. Per-event prefs persist to `localStorage`. The Zustand store's `lastTransition` is extended to expose `isNew` and `newAgentIds` so a single subscriber in `useNotifications` can detect every event type via predicates. The header bell remains the master + permission-request affordance; the new settings page only flips per-event flags.

**Tech Stack:** React 18, react-router-dom 6, Zustand, shadcn primitives (Switch, Sidebar, Card), lucide-react icons, TypeScript, Vite. No new dependencies. No backend or shared-types changes.

**Reference spec:** [`docs/superpowers/specs/2026-05-09-notification-settings-design.md`](../specs/2026-05-09-notification-settings-design.md)

**Testing reality:** This repo only has Playwright (no unit-test framework). For each task: typecheck → manual verify in the running browser preview → commit. One Playwright assertion is added at the end (Task 7) to lock in the `/settings` route shape, per spec §9.

**Working tree:** Run all commands from the repo root. The dev servers should already be running (`server` on `:7777`, `web` on `:5173`); if not, start with `pnpm turbo run dev`.

---

## File Structure

**New files:**

| Path | Responsibility |
|---|---|
| `apps/web/src/pages/settings.tsx` | Settings page shell — heading + section list. Stays small so future sections drop in easily. |
| `apps/web/src/components/settings/notifications-section.tsx` | Notifications section — description, optional permission notice, the five preference rows. |

**Modified files:**

| Path | Change |
|---|---|
| `apps/web/src/hooks/use-notifications.ts` | Add `NotificationEvent` type + per-event prefs helpers; expand `useNotifications()` to handle all five events. |
| `apps/web/src/lib/store.ts` | Extend `SessionTransition` with `isNew` and `newAgentIds`; populate them in `applyMessage` on `session_upsert`. |
| `apps/web/src/App.tsx` | Register `/settings` route alongside `/` and `/sessions/:id`. |
| `apps/web/src/pages/dashboard.tsx` | Add `<SidebarFooter>` Settings button; render `<Settings />` in `SidebarInset` when `pathname === "/settings"`. |
| `tests/happy-path.spec.ts` | Add an assertion that `/settings` renders the Notifications heading and five labelled switches. |

Tasks proceed bottom-up: data layer first (prefs, store), then trigger logic, then UI, then routing/integration, then test.

---

## Task 1: Notification preference helpers

Adds the per-event types and `localStorage` helpers without changing any behavior. The existing `useNotifications` keeps working because we don't touch its body in this task — only append new exports.

**Files:**
- Modify: `apps/web/src/hooks/use-notifications.ts`

- [ ] **Step 1: Open the file and read the existing module**

Run: `cat apps/web/src/hooks/use-notifications.ts`

Expected: top of file imports `useStore`, `SessionState`, `useEffect`. Existing exports are `isNotificationsEnabled`, `setNotificationsEnabled`, `useNotifications`. `ENABLED_KEY` constant is at the top.

- [ ] **Step 2: Add the event type, key map, defaults, and helpers above `function focusedSessionIdFromUrl`**

Insert this block immediately AFTER the existing `setNotificationsEnabled` function and BEFORE `function focusedSessionIdFromUrl`:

```ts
export type NotificationEvent =
  | "waiting_for_human"
  | "session_error"
  | "session_start"
  | "session_complete"
  | "subagent_spawn";

export type NotificationPrefs = Record<NotificationEvent, boolean>;

const PREF_KEYS: Record<NotificationEvent, string> = {
  waiting_for_human: "dashboard.notifications.waiting_for_human",
  session_error: "dashboard.notifications.session_error",
  session_start: "dashboard.notifications.session_start",
  session_complete: "dashboard.notifications.session_complete",
  subagent_spawn: "dashboard.notifications.subagent_spawn",
};

const DEFAULT_PREFS: NotificationPrefs = {
  waiting_for_human: true,
  session_error: true,
  session_start: false,
  session_complete: false,
  subagent_spawn: false,
};

function readPref(event: NotificationEvent): boolean {
  try {
    const raw = localStorage.getItem(PREF_KEYS[event]);
    if (raw === null) return DEFAULT_PREFS[event];
    return raw === "true";
  } catch {
    return DEFAULT_PREFS[event];
  }
}

export function getNotificationPrefs(): NotificationPrefs {
  return {
    waiting_for_human: readPref("waiting_for_human"),
    session_error: readPref("session_error"),
    session_start: readPref("session_start"),
    session_complete: readPref("session_complete"),
    subagent_spawn: readPref("subagent_spawn"),
  };
}

export function setNotificationPref(event: NotificationEvent, value: boolean): void {
  try {
    localStorage.setItem(PREF_KEYS[event], value ? "true" : "false");
  } catch {
    // private mode etc.
  }
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`

Expected: `Tasks: 4 successful, 4 total` — no errors.

- [ ] **Step 4: Verify defaults from the browser console**

Open http://localhost:5173 in the browser, open DevTools, and paste into the console:

```js
['waiting_for_human','session_error','session_start','session_complete','subagent_spawn']
  .map(k => [k, localStorage.getItem(`dashboard.notifications.${k}`)])
```

Expected: every value is `null` — no per-event keys have been written yet, so `getNotificationPrefs()` will return the `DEFAULT_PREFS` object (waiting_for_human + session_error true; others false). This is just a sanity check that nothing pre-existing collides with the new keys.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/hooks/use-notifications.ts
git commit -m "feat(web): add per-event notification pref helpers

Introduces NotificationEvent type, localStorage keys with sensible defaults
(waiting_for_human/session_error on, others off), and getNotificationPrefs
/ setNotificationPref helpers. Existing useNotifications behaviour is
unchanged — this task only adds the new surface."
```

---

## Task 2: Extend SessionTransition with isNew and newAgentIds

Lets the notifications hook detect events that aren't pure status transitions.

**Files:**
- Modify: `apps/web/src/lib/store.ts`

- [ ] **Step 1: Update the `SessionTransition` interface**

Change the interface near the top of `apps/web/src/lib/store.ts` from:

```ts
export interface SessionTransition {
  session: SessionState;
  prevStatus: SessionState["status"] | null;
}
```

to:

```ts
export interface SessionTransition {
  session: SessionState;
  prevStatus: SessionState["status"] | null;
  isNew: boolean;
  /** Agent ids in `session.agents` that were absent in the previous snapshot. Excludes `"main"`. */
  newAgentIds: string[];
}
```

- [ ] **Step 2: Update the `session_upsert` branch in `applyMessage`**

Replace the existing `session_upsert` case in the `applyMessage` switch:

```ts
case "session_upsert": {
  const prev = state.sessions[msg.session.id]?.status ?? null;
  return {
    seq: msg.seq,
    sessions: { ...state.sessions, [msg.session.id]: msg.session },
    lastTransition: { session: msg.session, prevStatus: prev },
  };
}
```

with:

```ts
case "session_upsert": {
  const prevSession = state.sessions[msg.session.id];
  const prevStatus = prevSession?.status ?? null;
  const isNew = !prevSession;
  const prevAgentIds = new Set(prevSession ? Object.keys(prevSession.agents) : []);
  const newAgentIds = Object.keys(msg.session.agents).filter(
    (id) => id !== "main" && !prevAgentIds.has(id),
  );
  return {
    seq: msg.seq,
    sessions: { ...state.sessions, [msg.session.id]: msg.session },
    lastTransition: {
      session: msg.session,
      prevStatus,
      isNew,
      newAgentIds,
    },
  };
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`

Expected: `4 successful`. The notifications hook still references `prevStatus` only — adding fields to the interface is backwards-compatible.

- [ ] **Step 4: Verify in-browser**

Reload http://localhost:5173 in the browser. The dashboard should still load and behave normally — no functional change yet, this just enriches the transition object.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/store.ts
git commit -m "feat(web): extend SessionTransition with isNew + newAgentIds

Captures whether a session_upsert is the session's first appearance and
which sub-agent ids were added in this update. The notifications hook
will use these to fire session-start and subagent-spawn notifications."
```

---

## Task 3: Wire up multi-event notification triggers

Refactor the `useNotifications` hook so its store subscriber dispatches to per-event predicates and notification copy. Each event reads its own `localStorage` flag in addition to the master + permission gates.

**Files:**
- Modify: `apps/web/src/hooks/use-notifications.ts`

- [ ] **Step 1: Add the SessionTransition import**

`SessionTransition` is already exported from `apps/web/src/lib/store.ts`. Add it to the existing imports at the top of `apps/web/src/hooks/use-notifications.ts`. The current import line:

```ts
import { useStore } from "@/lib/store.js";
```

becomes:

```ts
import type { SessionTransition } from "@/lib/store.js";
import { useStore } from "@/lib/store.js";
```

- [ ] **Step 2: Replace the `maybeNotify` function and the hook body**

Find this block in `apps/web/src/hooks/use-notifications.ts`:

```ts
function maybeNotify(session: SessionState): void {
  if (typeof Notification === "undefined") return;
  if (Notification.permission !== "granted") return;
  if (!isNotificationsEnabled()) return;

  const tabVisible = document.visibilityState === "visible";
  const sessionFocused = focusedSessionIdFromUrl() === session.id;
  if (tabVisible && sessionFocused) return;

  const title = `${session.cwd_basename} needs you`;
  const body = session.waiting_reason ?? "Waiting for input";
  try {
    new Notification(title, { body, tag: session.id });
  } catch {
    // permission state can race; ignore
  }
}

export function useNotifications(): void {
  useEffect(() => {
    const unsubscribe = useStore.subscribe((state, prev) => {
      const t = state.lastTransition;
      if (!t || t === prev.lastTransition) return;
      const wasWaiting = (t.prevStatus ?? null) === "waiting_for_human";
      const isWaiting = t.session.status === "waiting_for_human";
      if (wasWaiting || !isWaiting) return;
      maybeNotify(t.session);
    });
    return unsubscribe;
  }, []);
}
```

Replace it with:

```ts
type NotificationContent = { title: string; body: string };

function fire(session: SessionState, content: NotificationContent): void {
  if (typeof Notification === "undefined") return;
  if (Notification.permission !== "granted") return;
  if (!isNotificationsEnabled()) return;

  const tabVisible = document.visibilityState === "visible";
  const sessionFocused = focusedSessionIdFromUrl() === session.id;
  if (tabVisible && sessionFocused) return;

  try {
    new Notification(content.title, { body: content.body, tag: session.id });
  } catch {
    // permission state can race; ignore
  }
}

function dispatchNotifications(t: SessionTransition): void {
  const { session, prevStatus, isNew, newAgentIds } = t;
  const prefs = getNotificationPrefs();

  if (isNew && prefs.session_start) {
    fire(session, { title: "Session started", body: session.cwd_basename });
  }

  if (prefs.session_error && prevStatus !== "error" && session.status === "error") {
    const body =
      session.agents.main?.last_tool_input_summary ?? "Something went wrong";
    fire(session, { title: `${session.cwd_basename} error`, body });
  }

  if (prefs.session_complete && prevStatus !== "ended" && session.status === "ended") {
    fire(session, { title: `${session.cwd_basename} done`, body: "Session ended" });
  }

  if (
    prefs.waiting_for_human &&
    prevStatus !== "waiting_for_human" &&
    session.status === "waiting_for_human"
  ) {
    const body = session.waiting_reason ?? "Waiting for input";
    fire(session, { title: `${session.cwd_basename} needs you`, body });
  }

  if (prefs.subagent_spawn && newAgentIds.length > 0) {
    for (const agentId of newAgentIds) {
      const agent = session.agents[agentId];
      if (!agent) continue;
      fire(session, {
        title: `New ${agent.kind} agent`,
        body: session.cwd_basename,
      });
    }
  }
}

export function useNotifications(): void {
  useEffect(() => {
    const unsubscribe = useStore.subscribe((state, prev) => {
      const t = state.lastTransition;
      if (!t || t === prev.lastTransition) return;
      dispatchNotifications(t);
    });
    return unsubscribe;
  }, []);
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`

Expected: `4 successful`.

- [ ] **Step 4: Verify gating in the browser**

In DevTools at http://localhost:5173, run:

```js
// Master and per-event flags should match defaults: waiting_for_human + session_error on
JSON.stringify({
  master: localStorage.getItem('dashboard.notifications.enabled'),
  prefs: ['waiting_for_human','session_error','session_start','session_complete','subagent_spawn']
    .map(k => [k, localStorage.getItem('dashboard.notifications.'+k)])
})
```

Expected: master is `null` (not yet enabled — the existing bell still gates everything off), per-event keys are `null` (defaults apply).

The behavioural change is invisible until master is on. That's fine — the toggle wiring lands later. Existing waiting-for-human notifications are unaffected because the predicate is identical to before, just routed through `dispatchNotifications`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/hooks/use-notifications.ts
git commit -m "feat(web): dispatch notifications for all five event types

useNotifications now branches per event (start, error, complete, waiting,
subagent spawn), each gated by its own pref flag in addition to the
master + browser permission. The five events use distinct title/body
copy. Focus-suppression and tag:session.id collapsing apply uniformly."
```

---

## Task 4: Build the Settings page and NotificationsSection component

Builds the page UI. Not yet reachable via routing — Task 5 wires it in.

**Files:**
- Create: `apps/web/src/pages/settings.tsx`
- Create: `apps/web/src/components/settings/notifications-section.tsx`

- [ ] **Step 1: Create the NotificationsSection component**

Write `apps/web/src/components/settings/notifications-section.tsx`:

```tsx
import { Switch } from "@/components/ui/switch.js";
import {
  type NotificationEvent,
  getNotificationPrefs,
  setNotificationPref,
} from "@/hooks/use-notifications.js";
import { useEffect, useState } from "react";

const EVENTS: { event: NotificationEvent; label: string }[] = [
  { event: "waiting_for_human", label: "Waiting for human input" },
  { event: "session_error", label: "Session errors" },
  { event: "session_start", label: "New session starts" },
  { event: "session_complete", label: "Session completes" },
  { event: "subagent_spawn", label: "Subagent spawned" },
];

function readPermission(): NotificationPermission | "unsupported" {
  if (typeof Notification === "undefined") return "unsupported";
  return Notification.permission;
}

export function NotificationsSection() {
  const [prefs, setPrefs] = useState(() => getNotificationPrefs());
  const [permission, setPermission] = useState(() => readPermission());

  useEffect(() => {
    setPermission(readPermission());
  }, []);

  function handleChange(event: NotificationEvent, value: boolean) {
    setNotificationPref(event, value);
    setPrefs((prev) => ({ ...prev, [event]: value }));
  }

  return (
    <section className="flex flex-col gap-3">
      <header className="flex flex-col gap-1">
        <h3 className="font-medium text-base">Notifications</h3>
        <p className="text-fg/60 text-sm">
          Browser notifications for session events. Enable the bell in the header to
          receive any of these.
        </p>
      </header>
      {permission !== "granted" && (
        <p className="rounded-md border border-border bg-card px-3 py-2 text-fg/70 text-xs">
          Browser notifications are blocked. Enable the bell in the header first.
        </p>
      )}
      <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
        {EVENTS.map(({ event, label }) => (
          <li key={event} className="flex items-center justify-between gap-3 px-3 py-2.5">
            <label htmlFor={`notif-${event}`} className="text-sm">
              {label}
            </label>
            <Switch
              id={`notif-${event}`}
              data-testid={`notif-switch-${event}`}
              checked={prefs[event]}
              onCheckedChange={(v) => handleChange(event, v)}
              aria-label={label}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 2: Create the Settings page**

Write `apps/web/src/pages/settings.tsx`:

```tsx
import { NotificationsSection } from "@/components/settings/notifications-section.js";

export function Settings() {
  return (
    <div className="flex h-full flex-col">
      <div className="p-4">
        <h2 className="font-semibold text-lg">Settings</h2>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
        <NotificationsSection />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`

Expected: `4 successful`.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/settings.tsx apps/web/src/components/settings/notifications-section.tsx
git commit -m "feat(web): add Settings page with NotificationsSection

Page shell renders the section list; the Notifications section owns
the description, the optional permission notice, and five Switch rows
backed by getNotificationPrefs/setNotificationPref. Not yet routed —
wired in next."
```

---

## Task 5: Add the /settings route and dashboard integration

Make Settings reachable. The Dashboard already renders different content in `SidebarInset` based on whether a session is selected — we extend that to also handle `/settings`.

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/pages/dashboard.tsx`

- [ ] **Step 1: Register the route in App.tsx**

In `apps/web/src/App.tsx`, find the `<Routes>` block:

```tsx
<Routes>
  <Route path="/" element={<Dashboard />} />
  <Route path="/sessions/:id" element={<Dashboard />} />
  <Route path="*" element={<Navigate to="/" replace />} />
</Routes>
```

Insert a `/settings` route immediately after `/sessions/:id`:

```tsx
<Routes>
  <Route path="/" element={<Dashboard />} />
  <Route path="/sessions/:id" element={<Dashboard />} />
  <Route path="/settings" element={<Dashboard />} />
  <Route path="*" element={<Navigate to="/" replace />} />
</Routes>
```

- [ ] **Step 2: Render Settings inside the dashboard's SidebarInset**

In `apps/web/src/pages/dashboard.tsx`, find this block at the bottom:

```tsx
<div className="min-h-0 flex-1 overflow-hidden">
  {selected ? (
    <SessionDetail session={selected} />
  ) : (
    <EmptyState message="Select a session on the left." />
  )}
</div>
```

Replace it with:

```tsx
<div className="min-h-0 flex-1 overflow-hidden">
  {location.pathname === "/settings" ? (
    <Settings />
  ) : selected ? (
    <SessionDetail session={selected} />
  ) : (
    <EmptyState message="Select a session on the left." />
  )}
</div>
```

- [ ] **Step 3: Add the imports and `useLocation` to dashboard.tsx**

At the top of `dashboard.tsx`, add (or merge into the existing imports):

```tsx
import { Settings } from "@/pages/settings.js";
```

Update the `react-router-dom` import — it currently looks like:

```tsx
import { useNavigate, useParams } from "react-router-dom";
```

Change to:

```tsx
import { useLocation, useNavigate, useParams } from "react-router-dom";
```

In the `Dashboard` component body, alongside `const navigate = useNavigate();`, add:

```tsx
const location = useLocation();
```

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`

Expected: `4 successful`.

- [ ] **Step 5: Verify the route in the browser**

Navigate to http://localhost:5173/settings . Expected:

- Sidebar still renders (Agent Zoo header, sessions list, footer area empty for now).
- Right pane shows "Settings" heading and the "Notifications" section with five labelled switches.
- Toggling any switch persists across reload (verify by reloading and checking the switch state).

If `Notification.permission !== "granted"`, the inline notice ("Browser notifications are blocked…") appears above the rows.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/App.tsx apps/web/src/pages/dashboard.tsx
git commit -m "feat(web): route /settings to the Settings pane

Adds /settings to App.tsx routes and teaches Dashboard's SidebarInset
to render <Settings /> when the URL matches. The sidebar and page
chrome stay identical to the sessions view."
```

---

## Task 6: Add the Settings button in the sidebar footer

Now that the route works, add the entry point.

**Files:**
- Modify: `apps/web/src/pages/dashboard.tsx`

- [ ] **Step 1: Add the imports**

In `apps/web/src/pages/dashboard.tsx`, extend the existing sidebar imports to include `SidebarFooter`:

```tsx
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar.js";
```

Extend the `lucide-react` import to include `Settings as SettingsIcon`:

```tsx
import { Monitor, Settings as SettingsIcon } from "lucide-react";
```

(Aliased because `Settings` is already imported as the page component.)

- [ ] **Step 2: Add the SidebarFooter just before `</Sidebar>`**

In the JSX of `Dashboard`, locate the closing `</Sidebar>` tag right after `</SidebarContent>`. Insert a `<SidebarFooter>` between them:

```tsx
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                isActive={location.pathname === "/settings"}
                tooltip="Settings"
              >
                <button type="button" onClick={() => navigate("/settings")}>
                  <SettingsIcon />
                  <span>Settings</span>
                </button>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`

Expected: `4 successful`.

- [ ] **Step 4: Verify in the browser**

Reload http://localhost:5173 . Expected:

- Sidebar footer shows a Settings (gear) icon + "Settings" label below the session list.
- Clicking it navigates to `/settings`; the button shows the active highlight (`data-active=true` background).
- Clicking a session in the list afterwards drops the active highlight from Settings and routes back to `/sessions/:id`.
- Collapse the sidebar with the trigger; the Settings button shrinks to icon-only and shows the "Settings" tooltip on hover.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/dashboard.tsx
git commit -m "feat(web): add Settings button to sidebar footer

A SidebarFooter slot with a SidebarMenuButton (asChild) that navigates
to /settings. Reuses the same pattern as session-list rows, so active
state, icon-collapse, and tooltip all behave consistently."
```

---

## Task 7: Lock in the route shape with a Playwright assertion

Per spec §9 — confirm the page renders the heading and the five labelled switches.

**Files:**
- Modify: `tests/happy-path.spec.ts`

- [ ] **Step 1: Read the existing test to follow conventions**

Run: `cat tests/happy-path.spec.ts`

Note: tests already use `page.goto("/")`, `getByTestId(...)`, and `page.getByText(...)`. The existing single test seeds `seed-alpha` / `seed-beta`. Add a sibling test, not a replacement.

- [ ] **Step 2: Append a new test inside the existing `describe`**

Add this test as a second `test(...)` inside the existing `test.describe("agent-zoo happy path", () => { ... })` block:

```ts
test("settings page exposes the five notification switches", async ({ page }) => {
  await page.goto("/settings");

  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Notifications" })).toBeVisible();

  const expectedSwitches = [
    { id: "waiting_for_human", label: "Waiting for human input" },
    { id: "session_error", label: "Session errors" },
    { id: "session_start", label: "New session starts" },
    { id: "session_complete", label: "Session completes" },
    { id: "subagent_spawn", label: "Subagent spawned" },
  ];

  for (const { id, label } of expectedSwitches) {
    await expect(page.getByText(label, { exact: true })).toBeVisible();
    await expect(page.getByTestId(`notif-switch-${id}`)).toBeVisible();
  }

  // Toggling a switch persists across reload.
  const subagent = page.getByTestId("notif-switch-subagent_spawn");
  const before = await subagent.getAttribute("data-state");
  await subagent.click();
  await page.reload();
  const after = await page.getByTestId("notif-switch-subagent_spawn").getAttribute("data-state");
  expect(after).not.toBe(before);
});
```

- [ ] **Step 3: Run the Playwright suite**

Run: `pnpm test`

Expected: both tests pass. If the suite hasn't been run in this worktree before, Playwright may need browsers installed (`pnpm exec playwright install chromium`). The existing `happy-path` test must continue to pass — if it doesn't, the failure is unrelated to this plan and should be investigated before proceeding.

- [ ] **Step 4: Commit**

```bash
git add tests/happy-path.spec.ts
git commit -m "test: assert /settings renders five notification switches

Walks the route, finds the Settings + Notifications headings, asserts
each of the five labelled switches is visible by data-testid, and
verifies a switch toggle persists across reload."
```

---

## Final check

- [ ] **Step 1: Run typecheck and tests one last time**

Run:

```bash
pnpm typecheck
pnpm test
```

Expected: both green.

- [ ] **Step 2: Smoke-test the full flow in the browser**

At http://localhost:5173:

1. Click the Settings button in the sidebar footer → settings page shows.
2. Toggle a few switches → they persist on reload.
3. Click a session in the sidebar → returns to `/sessions/:id`.
4. Hit the bell in the header to enable notifications (grant permission when prompted).
5. With `waiting_for_human` notif on (default), background the tab and trigger a session into `waiting_for_human` (use `pnpm seed` if helpful or wait for a real session to enter it). Expect a notification.
6. Toggle `waiting_for_human` off in Settings; repeat — no notification fires.

- [ ] **Step 3: Push and open a PR (optional)**

```bash
git push -u origin HEAD
gh pr create --base master --title "feat(web): notification settings page" \
  --body "Implements docs/superpowers/specs/2026-05-09-notification-settings-design.md"
```

Done.
