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

  test("maps the file's boxes along its byte axis, and zooms into one on click", async ({ page }) => {
    await page.goto("/?tab=atoms");
    await page.locator("#loadSampleBtn").click();
    const panel = page.locator("#panel-atoms");
    await expect(panel.locator(".atom-map")).toBeVisible();

    // mdat is nearly the whole sample file, so it is the one box wide enough to carry its label.
    await expect(panel.locator(".atom-block.wide .lbl")).toHaveText(["mdat"]);
    await expect(panel.locator(".crumb")).toHaveText(["Whole file"]);

    // The moov subtree is too small a slice of the file to draw box by box; zooming opens it.
    await panel.locator(".atom-block.grouped").first().click();
    await expect(panel.locator(".crumb")).toHaveCount(2);
    await expect(panel.locator(".atom-block.wide .lbl").first()).toHaveText("moov");
    await expect(panel.locator(".atom-block.wide .lbl")).toContainText(["moov", "trak", "mdia"]);

    await panel.locator(".crumb").first().click();
    await expect(panel.locator(".crumb")).toHaveCount(1);
  });

  test("switches the Atom Map to the indented tree and remembers the choice", async ({ page }) => {
    await page.goto("/?tab=atoms");
    await page.locator("#loadSampleBtn").click();
    const panel = page.locator("#panel-atoms");
    await expect(panel.locator(".atom-map")).toBeVisible();

    await panel.getByRole("button", { name: "Vertical" }).click();
    await expect(panel.locator(".atom-tree")).toBeVisible();
    await expect(panel.locator(".atom-map")).toHaveCount(0);
    await expect(panel.locator(".atom-row").first()).toContainText("ftyp");

    await page.reload();
    await page.locator("#loadSampleBtn").click();
    await expect(panel.locator(".atom-tree")).toBeVisible();
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
