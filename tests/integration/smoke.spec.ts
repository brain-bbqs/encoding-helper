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

  test("frames the page with the BBQS, CON, and Talmo Lab watermarks", async ({ page }) => {
    // Wide enough that the corner watermarks stay in their fixed, viewport-anchored spots instead
    // of the narrow-screen fallback (see the max-width: 1420px query in style.css) that hides the
    // BBQS mark and flows the footer bar into the page to avoid overlapping content.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/");

    const bbqsLink = page.locator('a.brand-watermark-link[href="https://brain-bbqs.org"]');
    await expect(bbqsLink).toBeVisible();
    await expect(page.locator(".brand-watermark-logo")).toBeVisible();

    const versionLink = page.locator("#version-indicator");
    await expect(versionLink).toHaveText(/^v\d+\.\d+\.\d+$/);
    await expect(versionLink).toHaveAttribute("href", "https://github.com/brain-bbqs/encoding-helper");

    const conLink = page.locator('a.con-brand-link[href="https://centerforopenneuroscience.org"]');
    const talmoLink = page.locator('a.talmo-brand-link[href="https://talmolab.org/"]');
    await expect(conLink).toBeVisible();
    await expect(talmoLink).toBeVisible();
    await expect(page.locator(".talmo-brand-name")).toHaveText("Talmo Lab");
    // Only the variant matching the active theme is rendered.
    await expect(page.locator(".talmo-brand-logo.on-light")).toBeVisible();
    await expect(page.locator(".talmo-brand-logo.on-dark")).toBeHidden();

    // Talmo Lab sits to the left of CON, and both clear the centered page content.
    const talmoBox = (await talmoLink.boundingBox())!;
    const conBox = (await conLink.boundingBox())!;
    expect(talmoBox.x + talmoBox.width).toBeLessThanOrEqual(conBox.x);
    const contentRight = (await page.locator("#dropZone").boundingBox())!;
    expect(talmoBox.x).toBeGreaterThan(contentRight.x + contentRight.width);
  });

  test("swaps to the light-stroked Talmo Lab logo in dark mode", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    // Start from the light theme so the single toggle click below lands on dark.
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/");
    await page.locator("#themeToggle").click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.locator(".talmo-brand-logo.on-dark")).toBeVisible();
    await expect(page.locator(".talmo-brand-logo.on-light")).toBeHidden();
  });

  test("draws every box the Report tab lists, with none summarised away", async ({ page }) => {
    await page.goto("/?tab=atoms");
    await page.locator("#loadSampleBtn").click();
    const panel = page.locator("#panel-atoms");
    await expect(panel.locator(".atom-map")).toBeVisible();
    await expect(panel.locator(".atom-block.grouped")).toHaveCount(0);
    const drawn = await panel.locator(".atom-block").count();

    // The Report tab writes the same tree out as indented text from the same parse, so its line
    // count is an independent check that the map is not quietly leaving boxes out.
    await page.locator('.tab[data-tab="report"]').click();
    const listing = page.locator("#panel-report .section", { hasText: "MP4 Atom Map" }).locator("pre.cmd");
    const lines = ((await listing.textContent()) ?? "").trim().split("\n");
    expect(drawn).toBe(lines.length);
    expect(lines[0]).toContain("ftyp");
  });

  test("zooms into a box on click and walks back out with the breadcrumb", async ({ page }) => {
    await page.goto("/?tab=atoms");
    await page.locator("#loadSampleBtn").click();
    const panel = page.locator("#panel-atoms");
    await expect(panel.locator(".atom-map")).toBeVisible();
    await expect(panel.locator(".crumb")).toHaveText(["Whole file"]);

    await panel.locator(".atom-block.f-moov").first().click();
    await expect(panel.locator(".crumb")).toHaveText(["Whole file", "moov"]);
    // Zoomed to moov, its own subtree is all that is left and it fills the width.
    await expect(panel.locator(".atom-block.f-mdat")).toHaveCount(0);
    await expect(panel.locator(".atom-block").first()).toHaveAttribute("style", /width: 100%/);

    await panel.locator(".crumb").first().click();
    await expect(panel.locator(".crumb")).toHaveText(["Whole file"]);
    await expect(panel.locator(".atom-block.f-mdat")).toHaveCount(1);
  });

  test("drops the fixed watermarks once the viewport is too narrow to frame the page", async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.goto("/");
    await expect(page.locator(".brand-watermark-link")).toBeHidden();
    // The remaining watermarks stay, but in normal document flow under the page content.
    await expect(page.locator(".footer-brands")).toBeVisible();
    await expect(page.locator(".page-footer-bar")).toHaveCSS("position", "static");
  });
});
