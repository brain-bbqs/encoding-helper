import { test, expect } from "@playwright/test";
import { FIXTURE_SECONDS } from "../fixtures/demoVideo";
import { loadDemo, REFERENCE_FILE_NAME } from "./demoArchive";

test.describe("Encoding Helper shell", () => {
  test("renders the drop zone and hides the tabbed app until a file is loaded", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/Encoding Helper/);
    await expect(page.locator("#dropZone")).toBeVisible();
    await expect(page.locator("#app")).toBeHidden();
  });

  test("loading a demo file reveals the tabbed app", async ({ page }) => {
    await loadDemo(page);
    await expect(page.locator("#app")).toBeVisible();
    await expect(page.locator(".tab.on")).toContainText("Inspect");
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

  test("plots the loaded file's bitrate over time, one step per window", async ({ page }) => {
    await loadDemo(page);
    const card = page
      .locator("#panel-inspect .section")
      .filter({ has: page.locator('h2:text-is("Video Bitrate Over Time")') });
    await expect(card.locator("svg.bitrate-chart")).toBeVisible();
    // ~One window per second of video, each with its own hover band.
    await expect(card.locator("svg.bitrate-chart .bin")).toHaveCount(FIXTURE_SECONDS);

    // The demo is a CRF encode, so its peak window sits above its average rather than on it.
    const peak = await card.locator(".item", { hasText: "Peak Window" }).locator(".val").textContent();
    const average = await card.locator(".item", { hasText: "Average" }).first().locator(".val").textContent();
    expect(peak).not.toBe(average);

    // The average lives here now, so the Video Track card above no longer repeats it.
    const videoCard = page
      .locator("#panel-inspect .section")
      .filter({ has: page.locator('h2:text-is("Video Track")') });
    await expect(videoCard.locator(".item").filter({ has: page.locator('label:text-is("Bitrate")') })).toHaveCount(0);
  });

  test("draws every box in the file, in the tab and in the document, none summarised away", async ({ page }) => {
    // ?tab=atoms is the map's old address, from when it was a tab of its own; it lands on Inspect,
    // where the map is now a section.
    await loadDemo(page, "reference", "&tab=atoms");
    await expect(page).toHaveURL(/tab=inspect/);
    const panel = page.locator("#panel-inspect");
    await expect(panel.locator(".atom-map")).toBeVisible();
    await expect(panel.locator(".atom-block.grouped")).toHaveCount(0);
    const drawn = await panel.locator(".atom-block").count();

    // The breadcrumb counts the boxes the layout covers, including any swallowed by a group block,
    // so matching it against the blocks actually drawn is what catches boxes going missing.
    const covered = /(\d[\d,]*) box/.exec((await panel.locator(".crumb-range").textContent()) ?? "");
    expect(drawn).toBe(Number((covered?.[1] ?? "0").replace(/,/g, "")));

    // The document draws that same map, block for block — it is the whole of what it says about the
    // tree, so a box missing there is a box the reader never sees.
    await page.locator(".tab-action").click();
    const doc = page.frameLocator("#analysisDoc");
    await expect(doc.locator("#mp4-atom-map .atom-block")).toHaveCount(drawn);
    await expect(doc.locator("#mp4-atom-map .atom-legend")).toBeVisible();
    await expect(doc.locator("#mp4-atom-map .atom-block", { hasText: "mdat" })).toHaveCount(1);
    // Labels were sized when it was built, since the document runs no script to measure itself.
    await expect(doc.locator("#mp4-atom-map .atom-block.wide").first()).toBeVisible();
    // Offsets and sizes travel on the blocks themselves now that no text listing repeats them.
    await expect(doc.locator("#mp4-atom-map .atom-block").first()).toHaveAttribute("title", /offset 0/);
  });

  test("bundles the whole analysis into one document behind the Full Analysis button", async ({ page }) => {
    await loadDemo(page);

    // The button is not one of the tabs, and sits against the right edge of the content column.
    // The bar is inside #app, which is display:none until a file loads, and an unrendered element
    // has no box to measure — so wait for it to be on screen before asking where it is.
    const action = page.locator(".tab-action");
    await expect(page.locator("#app")).toBeVisible();
    await expect(action).toBeVisible();
    await expect(action).toHaveText(/Full Analysis/);
    await expect(page.locator(".tabs .tab")).toHaveCount(3);
    const tabsBox = (await page.locator(".tabs").boundingBox())!;
    const actionBox = (await action.boundingBox())!;
    const barBox = (await page.locator(".tab-bar").boundingBox())!;
    expect(actionBox.x).toBeGreaterThan(tabsBox.x + tabsBox.width - 1);
    expect(actionBox.x + actionBox.width).toBeCloseTo(barBox.x + barBox.width, 0);

    await action.click();
    await expect(action).toHaveClass(/on/);
    await expect(page).toHaveURL(/tab=analysis/);

    const doc = page.frameLocator("#analysisDoc");
    await expect(doc.locator(".doc-head h1")).toHaveText(REFERENCE_FILE_NAME);
    // One document, gathering what the separate tabs each know a piece of.
    for (const title of [
      "Video Container Overview",
      "Video Track",
      "Video Bitrate Over Time",
      "MP4 Atom Map",
      "GOP / Keyframe Structure",
      "Reencode CLI Command",
    ]) {
      await expect(doc.locator(".section h2", { hasText: title })).toBeVisible();
    }
    await expect(doc.locator("#video-bitrate-over-time svg.bitrate-chart")).toBeVisible();
    await expect(doc.locator(".doc-toc li")).not.toHaveCount(0);
    // Nothing was run by hand, so the sections those runs produce are simply absent.
    await expect(doc.locator("#empirical-seeking-test")).toHaveCount(0);

    // The preview is sized to the document, so the page scrolls rather than the frame.
    const frameHeight = (await page.locator("#analysisDoc").boundingBox())!.height;
    expect(frameHeight).toBeGreaterThan(1000);
  });

  test("adds the seeking test to the document once it has been run", async ({ page }) => {
    // The seeking test is the last section of Inspect; its old tab name still points at it.
    await loadDemo(page, "reference", "&tab=seek");
    await page.locator("#seekN").fill("5");
    await page.locator("#runSeekBtn").click();

    // The test decodes frames, which a Chromium built without proprietary codecs cannot do for
    // H.264 at all. That is a fact about the browser, not about the document, so skip there rather
    // than fail: either the run produced results or the app said why it could not.
    const tableFold = page.locator("#seekResultsWrap .fold");
    const failure = page.locator("#errorMsg", { hasText: "Seeking test failed" });
    await expect(tableFold.or(failure)).toBeVisible();
    test.skip(await failure.isVisible(), "this browser build cannot decode H.264");
    // The per-sample rows start folded away behind their bar, so open it to count them.
    await tableFold.locator("summary").click();
    await expect(page.locator("#seekResultsWrap table.data tbody tr")).toHaveCount(5);

    await page.locator(".tab-action").click();
    const doc = page.frameLocator("#analysisDoc");
    await expect(doc.locator("#empirical-seeking-test table.data tbody tr")).toHaveCount(5);
    await expect(doc.locator("#empirical-seeking-test svg.seek-scatter")).toBeVisible();
    await expect(doc.locator(".doc-toc")).toContainText("Empirical Seeking Test");
  });

  test("zooms into a box on click and walks back out with the breadcrumb", async ({ page }) => {
    await loadDemo(page);
    const panel = page.locator("#panel-inspect");
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

  // The one control in the page that says the sweep cache exists at all, so it is also the one
  // place its wiring can be checked end to end without running a sweep.
  test("forgets the stored sweep measurements from the footer", async ({ page }) => {
    await page.goto("/");
    const seeded = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("encoding-helper.matrix-cache", 1);
        request.onupgradeneeded = () => {
          for (const name of ["measurements", "windows"]) {
            request.result.createObjectStore(name, { keyPath: "key" }).createIndex("lastUsed", "lastUsed");
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const tx = db.transaction("measurements", "readwrite");
      tx.objectStore("measurements").put({ key: "swept", b: 4096, s: 5, ms: 1000, lastUsed: 1 });
      await new Promise((resolve) => (tx.oncomplete = resolve));
      const count = db.transaction("measurements").objectStore("measurements").count();
      const stored = await new Promise<number>((resolve) => (count.onsuccess = () => resolve(count.result)));
      db.close();
      return stored;
    });
    expect(seeded).toBe(1);

    const clearButton = page.locator("#clear-matrix-cache-btn");
    await expect(clearButton).toHaveText("Clear sweep cache");
    await clearButton.click();
    await expect(clearButton).toHaveText("Sweep cache cleared");

    await expect
      .poll(() =>
        page.evaluate(
          () =>
            new Promise<number>((resolve, reject) => {
              const request = indexedDB.open("encoding-helper.matrix-cache", 1);
              request.onsuccess = () => {
                const db = request.result;
                const count = db.transaction("measurements").objectStore("measurements").count();
                count.onsuccess = () => {
                  db.close();
                  resolve(count.result);
                };
              };
              request.onerror = () => reject(request.error);
            }),
        ),
      )
      .toBe(0);
    // The label goes back to what it was, so the control is there for the next time.
    await expect(clearButton).toHaveText("Clear sweep cache");
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
