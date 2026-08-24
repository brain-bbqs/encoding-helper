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

  test("lays the whole set out as one grid, grouped by what the files vary", async ({ page }) => {
    await gotoDemos(page);
    await expect(page.locator(".demos-group h2")).toHaveText([
      "Start here",
      "Atom layout",
      "Containers",
      "GOP and keyframe structure",
    ]);
    await expect(page.locator(".demo-tile")).toHaveCount(5);
    // The recording and the baseline encode share the leading row, the recording first.
    await expect(page.locator(".demos-group").first().locator(".demo-tile-name")).toHaveText([
      "The original recording, unmodified",
      "Reference: H.264 High in MP4, faststart",
    ]);
    // One card, not one per file.
    await expect(page.locator(".demo-card")).toHaveCount(1);
  });

  test("fills the card from whichever tile is pressed", async ({ page }) => {
    await gotoDemos(page);
    const card = page.locator(".demo-card");
    // It opens on the first tile rather than on an empty frame.
    await expect(card).toHaveAttribute("data-session", "original");

    await page.locator('.demo-tile[data-session="reference"]').click();
    await expect(card).toHaveAttribute("data-session", "reference");
    await expect(card.locator(".demo-title")).toHaveText("Reference: H.264 High in MP4, faststart");
    await expect(card.locator(".demo-desc")).toContainText("The baseline of the demo set");
    await expect(card.locator(".demo-download")).toHaveAttribute("download", REFERENCE_FILE_NAME);
    await expect(page.locator('.demo-tile[data-session="reference"]')).toHaveAttribute("aria-pressed", "true");

    await page.locator('.demo-tile[data-session="goplong"]').click();
    await expect(card.locator(".demo-title")).toHaveText("Long GOP: keyframe every ten seconds");
    await expect(page.locator('.demo-tile[data-session="reference"]')).toHaveAttribute("aria-pressed", "false");
    // The ffprobe figures and the command that made it are the app's job, not the card's.
    await expect(page.locator(".demo-facts, .demo-args")).toHaveCount(0);
  });

  test("marks the files the MP4 parser cannot open, and still offers to try", async ({ page }) => {
    await gotoDemos(page);
    const tile = page.locator('.demo-tile[data-session="matroska"]');
    await expect(tile.locator(".demo-tile-mark")).toBeVisible();
    await tile.click();
    const card = page.locator(".demo-card");
    await expect(card.locator(".demo-badge")).toHaveText("MP4 parser can't open this");
    await expect(card.locator(".demo-open")).toHaveText("Open it anyway");
  });

  test("filters the list as you type, and says so when nothing matches", async ({ page }) => {
    await gotoDemos(page);
    await page.locator("#demoSearch").fill("gop");
    await expect(page.locator(".demo-tile")).toHaveCount(1);
    await expect(page.locator(".demo-tile")).toHaveAttribute("data-session", "goplong");
    // The card follows the filter down to what is left.
    await expect(page.locator(".demo-card")).toHaveAttribute("data-session", "goplong");

    await page.locator("#demoSearch").fill("prores");
    await expect(page.locator(".demo-tile")).toHaveCount(0);
    await expect(page.locator(".demos-empty")).toBeVisible();
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
