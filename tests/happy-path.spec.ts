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
    await expect(page.getByText("alpha-reviewer-1")).toBeVisible();

    // alpha status is running
    await expect(alphaCard.locator('[data-testid="status-running"]')).toBeVisible();

    // theme picker switches default ↔ jrpg, flips data-theme on <html>
    await expect(page.locator("html")).toHaveAttribute("data-theme", "default");
    await page.getByTestId("theme-picker").click();
    await page.getByTestId("theme-option-jrpg").click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "jrpg");

    // mascot SVG content actually changes between themes
    const mascot = page.getByTestId("mascot-main").first();
    const jrpgSvg = await mascot.innerHTML();

    await page.getByTestId("theme-picker").click();
    await page.getByTestId("theme-option-default").click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "default");
    const defaultSvg = await mascot.innerHTML();
    expect(defaultSvg).not.toBe(jrpgSvg);
  });
});
