# Notification Settings Page — Design (2026-05-09)

Adds a `/settings` route with a Notifications section that lets the user pick
which session events fire browser notifications. Replaces the current
all-or-nothing master-only model with a master toggle + per-event preferences.

## 1. Problem

The dashboard fires browser notifications only on `waiting_for_human`
transitions (see `apps/web/src/hooks/use-notifications.ts`), gated by a single
boolean in `localStorage` flipped by the bell in the header. There is no way
for the user to:

- Be notified about other interesting transitions (errors, completions,
  session starts, sub-agents spawning).
- Opt out of `waiting_for_human` while keeping other events.
- Discover or configure notification behavior beyond toggling the bell.

## 2. Goal

A dedicated Settings page reachable from the sidebar footer. One section,
Notifications, with five independent switches covering the supported event
types. The bell in the header keeps its current role as a master on/off and
permission-request affordance.

## 3. Scope

In scope:

- New `/settings` route rendered into `SidebarInset`.
- New `Settings` button in `SidebarFooter`.
- Five per-event preferences in `localStorage`.
- Extending the store's `lastTransition` so the notifications hook can detect
  new sessions and newly-spawned sub-agents.
- New trigger predicates and per-event notification copy in
  `use-notifications.ts`.

Out of scope:

- Web Push / service worker delivery (notifications still require an open
  tab; explicitly noted in the existing app).
- Persisting preferences server-side or syncing across devices.
- Per-session muting, quiet hours, or any UI for clearing the OS
  notification queue.
- Additional Settings sections beyond Notifications (the page is structured
  to allow them later but only Notifications ships now).

## 4. UI

### 4.1 Sidebar footer button

Add a `<SidebarFooter>` slot to the existing `<Sidebar>` in
`apps/web/src/pages/dashboard.tsx`, containing a single `<SidebarMenuItem>` /
`<SidebarMenuButton asChild>` wrapping a `<button>` that calls
`navigate('/settings')`. Mirrors the session-list pattern already used in
`SidebarContent` so the active state, icon-collapse tooltip, and styling are
consistent.

- Icon: `Settings` (lucide-react gear).
- Label: `"Settings"`.
- `tooltip="Settings"` so the label survives icon-collapse.
- `isActive={location.pathname === '/settings'}` so the button highlights
  when the page is open.

### 4.2 Settings route

New route entry in `apps/web/src/App.tsx` (where the `<Routes>` block lives):
`<Route path="/settings" element={<Dashboard />} />`. The dashboard's
`SidebarInset` already renders `selected ? <SessionDetail/> : <EmptyState/>`;
extend that to also render `<Settings />` when on `/settings`.

### 4.3 Settings page layout

```
apps/web/src/pages/settings.tsx
└─ <Settings />
   ├─ header: "Settings" (h2, matches SessionDetail's heading style)
   └─ <NotificationsSection />
      ├─ heading: "Notifications"
      ├─ description copy (see below)
      ├─ permission notice (conditional, see §6)
      └─ five rows: <NotificationPrefRow event=… label=… />
```

Each `NotificationPrefRow` is a flex row: `<label>` on the left, the existing
`<Switch>` from `components/ui/switch.tsx` on the right.

Description copy under the section heading: *"Browser notifications for
session events. Enable the bell in the header to receive any of these."*

### 4.4 Component split

- `apps/web/src/pages/settings.tsx` — the page (header + section list).
- `apps/web/src/components/settings/notifications-section.tsx` — the
  Notifications section, owns the description, permission notice, and the
  five rows.
- The five rows are rendered inline by mapping over a typed list of
  `{ event, label }` so adding a new event type later is one entry.

This split keeps the page component a thin shell so additional sections
(themes, etc.) drop in without growing `settings.tsx`.

## 5. Storage and helpers

### 5.1 Keys

Five new `localStorage` keys, plus the existing master:

| Key                                              | Default |
| ------------------------------------------------ | ------- |
| `dashboard.notifications.enabled`                | `false` (existing — master, off until user enables) |
| `dashboard.notifications.waiting_for_human`      | `true`  |
| `dashboard.notifications.session_error`          | `true`  |
| `dashboard.notifications.session_start`          | `false` |
| `dashboard.notifications.session_complete`       | `false` |
| `dashboard.notifications.subagent_spawn`         | `false` |

### 5.2 Module shape

Refactor `apps/web/src/hooks/use-notifications.ts` to expose:

```ts
export type NotificationEvent =
  | "waiting_for_human"
  | "session_error"
  | "session_start"
  | "session_complete"
  | "subagent_spawn";

export type NotificationPrefs = Record<NotificationEvent, boolean>;

export function getNotificationPrefs(): NotificationPrefs;
export function setNotificationPref(event: NotificationEvent, value: boolean): void;
// existing master helpers stay:
export function isNotificationsEnabled(): boolean;
export function setNotificationsEnabled(enabled: boolean): void;
```

`getNotificationPrefs` reads each key (with try/catch for private mode) and
falls back to the default in §5.1. `setNotificationPref` writes through.

The Settings rows hold their own `useState` initialised from
`getNotificationPrefs()` and call `setNotificationPref` on change — same
pattern the existing bell uses.

## 6. Permission flow

Permission requests stay with the bell. The Settings page does **not** call
`Notification.requestPermission()`.

If `Notification.permission !== "granted"` when the user opens Settings, the
Notifications section renders a small inline notice above the rows:

> *"Browser notifications are blocked. Enable the bell in the header first."*

The switches remain interactive even when permission is not granted — toggling
them is harmless because `maybeNotify` (§7) gates on permission and master
before reading per-event prefs. This keeps the page predictable and avoids
hiding controls based on browser state.

## 7. Trigger logic

### 7.1 Store extension

Extend `SessionTransition` in `apps/web/src/lib/store.ts`:

```ts
export interface SessionTransition {
  session: SessionState;
  prevStatus: SessionState["status"] | null;   // existing
  isNew: boolean;                              // new — was undefined before
  newAgentIds: string[];                       // new — agent ids in
                                               //       session.agents that
                                               //       weren't in prev,
                                               //       excluding "main"
}
```

Computed in `applyMessage` on `session_upsert`:

```ts
const prev = state.sessions[msg.session.id];
const prevStatus = prev?.status ?? null;
const isNew = !prev;
const prevIds = prev ? new Set(Object.keys(prev.agents)) : new Set<string>();
const newAgentIds = Object.keys(msg.session.agents).filter(
  (id) => id !== "main" && !prevIds.has(id),
);
```

`applySnapshot` (which replaces the whole session map) still clears
`lastTransition` to `null` — snapshots don't fire notifications.

### 7.2 Predicates

In `useNotifications`'s store subscription, run each predicate against the new
transition. Each is **edge-triggered**: only fires when entering the state, so
re-renders or repeated upserts that don't move the relevant axis don't fire.

| Event              | Predicate                                                      |
| ------------------ | -------------------------------------------------------------- |
| `session_start`    | `t.isNew`                                                      |
| `session_error`    | `prevStatus !== "error"   && session.status === "error"`       |
| `session_complete` | `prevStatus !== "ended"   && session.status === "ended"`       |
| `waiting_for_human`| `prevStatus !== "waiting_for_human" && session.status === "waiting_for_human"` |
| `subagent_spawn`   | `t.newAgentIds.length > 0`                                     |

Subagent spawn fires one notification per new agent id. The other events fire
at most one notification per session per upsert.

### 7.3 Gating order

For each candidate notification:

1. `Notification` API exists.
2. `Notification.permission === "granted"`.
3. `isNotificationsEnabled()` (master) is true.
4. The per-event pref for that event is true.
5. Focus suppression: skip if `document.visibilityState === "visible"` AND
   the URL points at this session (`/sessions/<id>`). Applies uniformly to
   all five events.

If any of 1–5 fails, the notification is silently dropped.

### 7.4 Notification copy

| Event              | Title                          | Body                                                |
| ------------------ | ------------------------------ | --------------------------------------------------- |
| `session_start`    | `Session started`              | `${session.cwd_basename}`                           |
| `session_error`    | `${cwd_basename} error`        | `last_tool_input_summary` ?? `"Something went wrong"` |
| `session_complete` | `${cwd_basename} done`         | `"Session ended"`                                   |
| `waiting_for_human`| `${cwd_basename} needs you`    | `waiting_reason ?? "Waiting for input"` (existing)  |
| `subagent_spawn`   | `New ${agent.kind} agent`      | `${cwd_basename}`                                   |

All notifications use `tag: session.id` so the OS notification center
collapses repeated events for the same session into a single banner. The
subagent variant intentionally shares the tag — multiple sub-agents in the
same session collapse together rather than stacking.

## 8. Files touched

New:

- `apps/web/src/pages/settings.tsx`
- `apps/web/src/components/settings/notifications-section.tsx`

Modified:

- `apps/web/src/hooks/use-notifications.ts` — adds `NotificationEvent`
  type, prefs helpers, and the four new predicates / copy. Existing
  master helpers and `useNotifications()` signature unchanged.
- `apps/web/src/lib/store.ts` — extends `SessionTransition` with
  `isNew` and `newAgentIds`; updates `applyMessage` to populate them.
- `apps/web/src/pages/dashboard.tsx` — adds `<SidebarFooter>` with the
  Settings button; extends `SidebarInset` rendering to show
  `<Settings />` when `pathname === '/settings'`.
- `apps/web/src/App.tsx` — registers the `/settings` route alongside
  the existing `/` and `/sessions/:id` routes.

No server, shared-types, or protocol changes.

## 9. Testing

- Manual: toggle each switch, trigger the corresponding event by seeding /
  driving sessions, confirm the notification fires (or doesn't) per the
  matrix in §7.
- Manual: toggle the master bell off — confirm no event fires regardless of
  per-event state.
- Manual: open Settings while focused on a session, confirm notifications
  for that session don't fire while the tab is visible (§7.3 step 5).
- Add a Playwright assertion that the `/settings` route renders the
  Notifications heading and five switches with the labels in §5.1. Existing
  `tests/happy-path.spec.ts` continues to pass.

## 10. Risks

- **Subagent detection brittleness.** Sub-agents are inferred by diffing the
  agent-id set on each upsert. If the server ever emits a snapshot in the
  middle of a session (e.g. on reconnect), every sub-agent will look "new"
  and re-fire. Mitigation: `applySnapshot` clears `lastTransition`, so the
  hook never sees a transition for snapshot-replaced sessions; subagent
  spawn only fires from `session_upsert`.
- **OS notification quotas.** Aggressive per-event settings (all five on)
  could fire several notifications per session. The shared `tag: session.id`
  collapses repeats per-session but not across sessions. Acceptable; the
  user picks the noise level.
- **Permission state races.** The page reads `Notification.permission` once
  on mount. If the user changes browser site settings while the page is
  open, the inline notice may stale. Mitigation: same as the existing bell
  — re-read on next mount; not worth a `permissionchange` listener.
