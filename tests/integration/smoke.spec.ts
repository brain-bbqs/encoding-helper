import { test, expect } from "@playwright/test";

test.describe("Encoding Helper shell", () => {
  test("renders the drop zone and hides the tabbed app until a file is loaded", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/Encoding Helper/);
    await expect(page.locator("#dropZone")).toBeVisible();
    await expect(page.locator("#app")).toBeHidden();
  });

  test("loading the sample video reveals the tabbed app", async ({ page }) => {
    await page.goto("/");
    await page.locator("#loadSampleBtn").click();
    await expect(page.locator("#app")).toBeVisible();
    await expect(page.locator(".tab.on")).toHaveText("Inspect");
    await expect(page.locator("#panel-inspect")).not.toBeEmpty();
  });
});
