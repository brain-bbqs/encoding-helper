// Drops made through Chromium's own drag input, the path a drag from the desktop or another window
// takes, so the browser's default actions run: dropped text landing in a box, which jsdom does not
// have. The unit tests in tests/unit/fileLoading.test.ts cover which drags the page cancels.

import { expect, test, type Page } from "@playwright/test";
import { buildFixtureVideo } from "../fixtures/demoVideo";
import { gotoDemos, loadDemo, REFERENCE_FILE_NAME } from "./demoArchive";

/** What CDP's Input.dispatchDragEvent carries: the drag's data and the operations its source allows. */
interface DragData {
  items: { mimeType: string; data: string }[];
  files?: string[];
  dragOperationsMask: number;
}

const COPY = 1;
const LINK = 2;
const MOVE = 16;

function fileDrag(): DragData {
  return { items: [], files: [buildFixtureVideo()], dragOperationsMask: COPY };
}

/** A link as it comes from another tab's address bar or page. */
function linkDrag(url: string): DragData {
  return {
    items: [
      { mimeType: "text/uri-list", data: url },
      { mimeType: "text/plain", data: url },
    ],
    dragOperationsMask: COPY | LINK | MOVE,
  };
}

function textDrag(text: string): DragData {
  return { items: [{ mimeType: "text/plain", data: text }], dragOperationsMask: COPY | MOVE };
}

/** Drags `data` in over the page, holds it at (x, y) and lets go there. */
async function dropAt(page: Page, x: number, y: number, data: DragData): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  for (const type of ["dragEnter", "dragOver", "drop"] as const) {
    await cdp.send("Input.dispatchDragEvent", { type, x, y, data });
  }
  await cdp.detach();
}

async function dropOn(page: Page, selector: string, data: DragData): Promise<void> {
  const box = await page.locator(selector).boundingBox();
  if (!box) throw new Error(`${selector} is not on screen`);
  await dropAt(page, box.x + box.width / 2, box.y + box.height / 2, data);
}

/** Every page the browser opens beside `page` from now on, filled in as they open. */
function collectNewPages(page: Page): Page[] {
  const opened: Page[] = [];
  page.context().on("page", (p) => opened.push(p));
  return opened;
}

/**
 * The addresses of the pages in `opened`, once a browser about to open one has had the time to.
 * There is no event for a page not opening, so this waits a fixed while for one that does: the tab
 * Chromium opens for a drop it was left arrives within tens of milliseconds.
 */
async function settledNewPages(page: Page, opened: Page[]): Promise<string[]> {
  if (!opened.length)
    await page
      .context()
      .waitForEvent("page", { timeout: 1000 })
      .catch(() => undefined);
  return opened.map((p) => p.url());
}

test.describe("dropping onto the page", () => {
  test("loads a file dropped on the drop zone", async ({ page }) => {
    await page.goto("/");
    await dropOn(page, "#dropZone .drop-full > div:first-child", fileDrag());
    await expect(page.locator("#app")).toBeVisible();
    await expect(page.locator("#miniName")).toHaveText("demo-reference.mp4");
  });

  test("puts a link dropped on the URL box into the box", async ({ page }) => {
    const url = "https://example.org/dropped.mp4";
    await page.goto("/");
    await page.locator("#showUrlBtn").click();
    await dropOn(page, "#urlInput", linkDrag(url));
    await expect(page.locator("#urlInput")).toHaveValue(url);
    await expect(page.locator("#dropZone")).not.toHaveClass(/dragover/);
    await expect(page.locator("#app")).toBeHidden();
  });

  // Off the URL box a link has nowhere to go on the zone, so the zone refuses it rather than leave
  // the browser to open it.
  test("refuses a link dropped on the drop zone beside the URL box", async ({ page }) => {
    const opened = collectNewPages(page);
    await page.goto("/");
    await page.locator("#showUrlBtn").click();
    await dropOn(page, "#dropZone .drop-full > div:first-child", linkDrag(new URL("/dropped.mp4", page.url()).href));
    expect(await settledNewPages(page, opened)).toEqual([]);
    await expect(page.locator("#urlInput")).toHaveValue("");
    await expect(page.locator("#dropZone")).not.toHaveClass(/dragover/);
    await expect(page.locator("#app")).toBeHidden();
  });

  // A drop the page leaves uncancelled is the browser's to open, which Chromium does in a tab of its
  // own, so a new page is what a missing guard shows up as.
  test("refuses a file dropped beside the drop zone", async ({ page }) => {
    const opened = collectNewPages(page);
    await page.goto("/");
    await page.evaluate(() => {
      const seen: string[] = [];
      Object.assign(window, { seenDrops: seen });
      window.addEventListener("drop", (e) => {
        // Read once the event is over, so the app's own listeners have run too.
        setTimeout(() => seen.push(`cancelled: ${e.defaultPrevented}`), 0);
      });
    });
    const zone = (await page.locator("#dropZone").boundingBox())!;
    await dropAt(page, 4, zone.y + zone.height + 40, fileDrag());
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { seenDrops: string[] }).seenDrops))
      .toEqual(["cancelled: true"]);
    expect(await settledNewPages(page, opened)).toEqual([]);
    await expect(page.locator("#app")).toBeHidden();
  });

  // The preview is a document of its own, so a drop on it never reaches the page's window, and it
  // takes up most of the tab.
  test("refuses a file dropped on the Full Analysis preview", async ({ page }) => {
    const opened = collectNewPages(page);
    await loadDemo(page);
    await page.locator(".tab-action").click();
    await expect(page.frameLocator("#analysisDoc").locator(".doc-head h1")).toHaveText(REFERENCE_FILE_NAME);
    const frame = page.locator("#analysisDoc");
    await frame.scrollIntoViewIfNeeded();
    // Into the middle of the part of the frame on screen: it is taller than the viewport.
    const box = (await frame.boundingBox())!;
    const top = Math.max(box.y, 0);
    const bottom = Math.min(box.y + box.height, page.viewportSize()!.height);
    await dropAt(page, box.x + box.width / 2, (top + bottom) / 2, fileDrag());
    expect(await settledNewPages(page, opened)).toEqual([]);
    await expect(page.locator("#miniName")).toHaveText(REFERENCE_FILE_NAME);
  });

  test("leaves text dropped into the demo filter to the filter", async ({ page }) => {
    await gotoDemos(page);
    await dropOn(page, "#demoSearch", textDrag("gopshort"));
    await expect(page.locator("#demoSearch")).toHaveValue("gopshort");
  });
});
