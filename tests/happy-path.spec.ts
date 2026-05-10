import { expect, test } from "@playwright/test";

test.describe("agent-zoo happy path", () => {
  test("seeded sessions render, sort, switch theme, expose waiting state", async ({ page }) => {
    await page.goto("/");

    const alphaCard = page.getByTestId("session-card-seed-alpha");
    const betaCard = page.getByTestId("session-card-seed-beta");

    await expect(alphaCard).toBeVisible({ timeout: 5000 });
    await expect(betaCard).toBeVisible();

    // beta is waiting_for_human, alpha is running → beta sorts first
    const cards = page.locator('[data-testid^="session-card-"]');
    const ids = await cards.evaluateAll((nodes) => nodes.map((n) => n.getAttribute("data-testid")));
    expect(ids[0]).toBe("session-card-seed-beta");

    // beta status badge
    await expect(betaCard.locator('[data-testid="status-waiting_for_human"]')).toBeVisible();

    // selecting alpha opens the detail pane with the agent tree
    await alphaCard.click();
    await expect(page).toHaveURL(/\/sessions\/seed-alpha$/);

    // alpha-explorer-1 stays active and is visible by default
    await expect(page.getByText("alpha-explorer-1")).toBeVisible();

    // alpha-general-1 ended via SubagentStop and is hidden by default;
    // reveal it via the toggle before asserting visibility.
    await page.getByRole("button", { name: /show ended/i }).click();
    await expect(page.getByText("alpha-general-1")).toBeVisible();

    // capture full-page screenshot for visual review (gitignored under test-results/)
    await page.screenshot({
      path: "test-results/session-detail-with-subs.png",
      fullPage: true,
    });

    // alpha status is running
    await expect(alphaCard.locator('[data-testid="status-running"]')).toBeVisible();

    // theme picker switches default ↔ final-fantasy-v, flips data-theme on <html>
    await expect(page.locator("html")).toHaveAttribute("data-theme", "default");
    await page.getByTestId("theme-picker").click();
    await page.getByTestId("theme-option-final-fantasy-v").click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "final-fantasy-v");

    // mascot DOM changes between themes (default = inline SVG, FFV = sprite wrapper)
    const mascot = page.getByTestId("mascot-main").first();
    const ffvHtml = await mascot.innerHTML();

    await page.getByTestId("theme-picker").click();
    await page.getByTestId("theme-option-default").click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "default");
    const defaultHtml = await mascot.innerHTML();
    expect(defaultHtml).not.toBe(ffvHtml);
  });

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
});
