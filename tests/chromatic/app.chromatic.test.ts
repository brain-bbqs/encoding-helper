import { test, expect } from "@chromatic-com/playwright";
import { gotoDemos, loadDemo } from "../integration/demoArchive";
import { VIEWPORTS, expectNoHorizontalOverflow } from "../integration/layout";

// One test per viewport rather than one per Playwright project: see VIEWPORTS for why. The Chromatic
// fixture snapshots the page after each test body, named by the test's title, so the viewport in
// the title is what tells the captures apart.
for (const viewport of VIEWPORTS) {
  const size = { width: viewport.width, height: viewport.height };

  test(`Main page - default [${viewport.name}]`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.goto("/");
    await expect(page.locator("#dropZone")).toBeVisible();
    await expect(page.locator("#app")).toBeHidden();
    await expectNoHorizontalOverflow(page);
  });

  test(`Demos page [${viewport.name}]`, async ({ page }) => {
    await page.setViewportSize(size);
    await gotoDemos(page);
    await expect(page.locator("#dropZone")).toBeHidden();
    await expect(page.locator(".demos-group").first()).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test(`Main page - demo file loaded [${viewport.name}]`, async ({ page }) => {
    await page.setViewportSize(size);
    await loadDemo(page);
    await expect(page.locator("#app")).toBeVisible();
    await expect(page.locator(".tab.on")).toContainText("Inspect");
    await expectNoHorizontalOverflow(page);
  });
}
