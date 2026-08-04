import { test, expect } from "@chromatic-com/playwright";

test("Main page - default", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#dropZone")).toBeVisible();
  await expect(page.locator("#app")).toBeHidden();
});

test("Main page - sample loaded", async ({ page }) => {
  await page.goto("/");
  await page.locator("#loadSampleBtn").click();
  await expect(page.locator("#app")).toBeVisible();
  await expect(page.locator(".tab.on")).toHaveText("Inspect");
});
