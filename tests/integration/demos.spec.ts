import { test, expect } from "@playwright/test";
import { gotoDemos, loadDemo, mockDemoArchive, REFERENCE_FILE_NAME } from "./demoArchive";

test.describe("Demo files page", () => {
  test("opens in place of the file picker, and goes back to it", async ({ page }) => {
    await mockDemoArchive(page);
    await page.goto("/");
    await page.locator("#browseDemosBtn").click();

    await expect(page).toHaveURL(/\?demos/);
    await expect(page.locator("#demosPage")).toBeVisible();
    await expect(page.locator("#dropZone")).toBeHidden();

    await page.locator("#demosBackBtn").click();
    await expect(page.locator("#demosPage")).toBeHidden();
    await expect(page.locator("#dropZone")).toBeVisible();
    await expect(page).not.toHaveURL(/demos/);
  });

  test("the browser's back button leaves the page the way it arrived", async ({ page }) => {
    await mockDemoArchive(page);
    await page.goto("/");
    await page.locator("#browseDemosBtn").click();
    await expect(page.locator("#demosPage")).toBeVisible();

    await page.goBack();
    await expect(page.locator("#demosPage")).toBeHidden();
    await expect(page.locator("#dropZone")).toBeVisible();
  });

  test("groups the files by what they vary, and names where the set came from", async ({ page }) => {
    await gotoDemos(page);
    await expect(page.locator(".demos-group h2")).toHaveText([
      "Reference",
      "Atom layout",
      "Containers",
      "GOP and keyframe structure",
    ]);
    await expect(page.locator(".demo-card")).toHaveCount(4);
    await expect(page.locator(".demos-provenance")).toContainText("EMBER dandiset 000527");
    await expect(page.locator(".demos-provenance a").first()).toHaveAttribute("href", /dandiset\/000527/);
  });

  test("folds a file open to its description, its figures and the command that made it", async ({ page }) => {
    await gotoDemos(page);
    const card = page.locator('details.demo-card[data-session="reference"]');
    await expect(card.locator(".demo-desc")).toHaveCount(0);

    await card.locator("summary").click();
    await expect(card.locator(".demo-desc")).toContainText("The baseline of the demo set");
    await expect(card.locator(".demo-facts")).toContainText("320 × 240");
    await expect(card.locator(".demo-args")).toContainText("ffmpeg -i Video_S1.m4v");
    await expect(card.locator(".demo-download")).toHaveAttribute("download", REFERENCE_FILE_NAME);
  });

  test("marks, and can hide, the files the MP4 parser cannot open", async ({ page }) => {
    await gotoDemos(page);
    const mkv = page.locator('details.demo-card[data-session="matroska"]');
    await expect(mkv.locator(".demo-badge")).toHaveText("MP4 parser can't open this");

    await page.locator("#demoLoadableOnly").check();
    await expect(mkv).toHaveCount(0);
    await expect(page.locator(".demo-card")).toHaveCount(3);
  });

  test("filters the list as you type, and says so when nothing matches", async ({ page }) => {
    await gotoDemos(page);
    await page.locator("#demoSearch").fill("gop");
    await expect(page.locator(".demo-card")).toHaveCount(1);
    await expect(page.locator(".demo-card")).toHaveAttribute("data-session", "goplong");

    await page.locator("#demoSearch").fill("prores");
    await expect(page.locator(".demo-card")).toHaveCount(0);
    await expect(page.locator(".demos-empty")).toBeVisible();
  });

  test("expands and collapses every fold at once", async ({ page }) => {
    await gotoDemos(page);
    await page.getByRole("button", { name: "Expand all" }).click();
    await expect(page.locator("details.demo-card[open]")).toHaveCount(4);
    await page.getByRole("button", { name: "Collapse all" }).click();
    await expect(page.locator("details.demo-card[open]")).toHaveCount(0);
  });

  test("opens the picked file in the app, under its own name and as a shareable link", async ({ page }) => {
    await loadDemo(page);
    await expect(page.locator("#demosPage")).toBeHidden();
    await expect(page.locator("#miniName")).toHaveText(REFERENCE_FILE_NAME);
    await expect(page).toHaveURL(/src=/);
    await expect(page).not.toHaveURL(/demos/);
    await expect(page.locator("#panel-inspect .atom-map")).toBeVisible();
  });

  test("says why rather than showing an empty page when the archive cannot be reached", async ({ page }) => {
    await page.route("**/api-dandi.emberarchive.org/**", (route) => route.fulfill({ status: 503, body: "down" }));
    await page.goto("/?demos");
    await expect(page.locator(".demos-error")).toBeVisible();
    await expect(page.locator(".demos-error-hint")).toContainText("EMBER dandiset 000527");
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  });
});
