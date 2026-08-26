import { test, expect } from "@chromatic-com/playwright";
import { gotoDemos, loadDemo } from "../integration/demoArchive";

test("Main page - default", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#dropZone")).toBeVisible();
  await expect(page.locator("#app")).toBeHidden();
});

test("Demos page", async ({ page }) => {
  await gotoDemos(page);
  await expect(page.locator("#dropZone")).toBeHidden();
  await expect(page.locator(".demos-group").first()).toBeVisible();
});

test("Main page - demo file loaded", async ({ page }) => {
  await loadDemo(page);
  await expect(page.locator("#app")).toBeVisible();
  await expect(page.locator(".tab.on")).toContainText("Inspect");
});
