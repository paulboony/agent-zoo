import { expect, test } from "@playwright/test";

test.describe("agent-zoo happy path", () => {
  // Each test starts from a clean localStorage so theme / notification
  // pref state doesn't bleed across tests (or across CI re-runs).
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => localStorage.clear());
  });

  test("sidebar lists seeded sessions sorted by urgency", async ({ page }) => {
    await page.goto("/");

    const alphaCard = page.getByTestId("session-card-seed-alpha");
    const betaCard = page.getByTestId("session-card-seed-beta");
    await expect(alphaCard).toBeVisible({ timeout: 5000 });
    await expect(betaCard).toBeVisible();

    // beta is blocked, alpha is running → beta sorts first.
    const cards = page.locator('[data-testid^="session-card-"]');
    const ids = await cards.evaluateAll((nodes) =>
      nodes.map((n) => n.getAttribute("data-testid")),
    );
    expect(ids[0]).toBe("session-card-seed-beta");
    await expect(betaCard.locator('[data-testid="status-blocked"]')).toBeVisible();
    await expect(alphaCard.locator('[data-testid="status-running"]')).toBeVisible();
  });

  test("clicking a session opens its detail with the sub-agent tree + prompts", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByTestId("session-card-seed-alpha").click();
    await expect(page).toHaveURL(/\/sessions\/seed-alpha$/);

    // Active sub-agents are visible by default.
    await expect(page.getByText("alpha-explorer-1")).toBeVisible();
    await expect(page.getByText("alpha-reviewer-2")).toBeVisible();

    // Sub-agent cards surface the Task tool's `prompt` body, line-clamped
    // above the toolcall.
    await expect(
      page.getByText(/Investigate how the notification preferences are persisted/i),
    ).toBeVisible();
  });

  test("Show ended toggle reveals SubagentStop'd children", async ({ page }) => {
    await page.goto("/sessions/seed-alpha");
    // Wait for the SSE-driven hydration to populate the session detail
    // before asserting on what's hidden — without this, getByText(...)
    // .toHaveCount(0) passes vacuously against the unmounted tree.
    await expect(page.getByText("alpha-explorer-1")).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("alpha-reviewer-1")).toHaveCount(0);
    await page.getByRole("button", { name: /show ended/i }).click();
    await expect(page.getByText("alpha-reviewer-1")).toBeVisible();
  });

  // Per-theme custom card sentinels. Default has no agentCard, so the
  // sentinel is absent (DefaultAgentCard renders). The others each ship
  // their own agent-card.tsx via the theme.agentCard hook.
  const THEMES = [
    { id: "default", customCardTestid: null },
    { id: "final-fantasy-v", customCardTestid: "ff-agent-card" },
    { id: "final-fantasy", customCardTestid: "ff1-agent-card" },
    { id: "super-mario-bros", customCardTestid: "smb-agent-card" },
  ] as const;

  for (const { id, customCardTestid } of THEMES) {
    if (!customCardTestid) continue;
    test(`theme ${id} renders its custom agent card`, async ({ page }) => {
      await page.goto("/sessions/seed-alpha");
      // Wait for hydration; the custom card only renders once an agent
      // is in the tree.
      await expect(page.getByText("alpha-explorer-1")).toBeVisible({ timeout: 5000 });
      await page.getByTestId("theme-picker").click();
      await page.getByTestId(`theme-option-${id}`).click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", id);
      // theme.agentCard is React.lazy() — Suspense streams the chunk
      // in. Longer timeout since first-render fetches the JS bundle.
      await expect(page.getByTestId(customCardTestid).first()).toBeVisible({
        timeout: 5000,
      });
    });
  }

  test("switching themes swaps the mascot render mode (svg ↔ sprite)", async ({ page }) => {
    await page.goto("/sessions/seed-alpha");
    await expect(page.getByText("alpha-explorer-1")).toBeVisible({ timeout: 5000 });
    // Default theme: each Mascot renders as inline SVG.
    await expect(page.locator("html")).toHaveAttribute("data-theme", "default");
    await expect(page.getByTestId("mascot-main").first()).toHaveAttribute(
      "data-render",
      "svg",
    );

    await page.getByTestId("theme-picker").click();
    await page.getByTestId("theme-option-final-fantasy-v").click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "final-fantasy-v");
    // FFV uses a sprite sheet; the Mascot wrapper exposes data-render="sprite".
    await expect(page.getByTestId("mascot-main").first()).toHaveAttribute(
      "data-render",
      "sprite",
    );
  });

  test("dashboard landing surfaces attention list + running chips", async ({ page }) => {
    await page.goto("/");

    const attentionRow = page.getByTestId("dash-attention-seed-beta");
    await expect(attentionRow).toBeVisible();
    await expect(attentionRow.getByText(/Allow Write to \/etc\/hosts\?/)).toBeVisible();
    await expect(page.getByTestId("dash-running-seed-alpha")).toBeVisible();

    await expect(page.getByRole("heading", { name: /Needs attention/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Running/i })).toBeVisible();

    // Clicking the attention row opens the session detail.
    await attentionRow.click();
    await expect(page).toHaveURL(/\/sessions\/seed-beta$/);
  });

  test("worktree badge renders for a session whose cwd is a linked checkout", async ({
    page,
  }) => {
    // seed-gamma's cwd is a real git worktree created by the seed.
    // The server detects via `git rev-parse --git-dir/--git-common-dir`
    // and broadcasts a follow-up session_upsert with is_worktree=true.
    // The badge testid is reused across the sidebar card, dashboard
    // running chip, and (when viewing the session) the detail header,
    // so we scope to the sidebar card to avoid strict-mode collisions.
    await page.goto("/");
    const gammaCard = page.getByTestId("session-card-seed-gamma");
    await expect(gammaCard).toBeVisible({ timeout: 5000 });
    await expect(gammaCard.getByTestId("worktree-badge-seed-gamma")).toBeVisible();
  });

  test("settings page exposes the five notification switches", async ({ page }) => {
    await page.goto("/settings");

    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Notifications" })).toBeVisible();

    const expectedSwitches = [
      { id: "blocked", label: "Needs your input" },
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
    const after = await page
      .getByTestId("notif-switch-subagent_spawn")
      .getAttribute("data-state");
    expect(after).not.toBe(before);
  });
});
