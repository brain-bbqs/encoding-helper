// Drops made through Chromium's own drag input, the path a drag from the desktop or another window
// takes, so the browser's default actions run: dropped text landing in a box, which jsdom does not
// have. The unit tests in tests/unit/fileLoading.test.ts cover which drags the page cancels.

import { expect, test, type Page } from "@playwright/test";
import { buildFixtureVideo } from "../fixtures/demoVideo";
import { gotoDemos } from "./demoArchive";

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

  // Whether a browser then opens the file in the tab is up to the browser (the Chromium these tests
  // drive does not, refused or not), so what is checked is that the page refused the drop.
  test("refuses a file dropped beside the drop zone", async ({ page }) => {
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
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator("#app")).toBeHidden();
  });

  test("leaves text dropped into the demo filter to the filter", async ({ page }) => {
    await gotoDemos(page);
    await dropOn(page, "#demoSearch", textDrag("gopshort"));
    await expect(page.locator("#demoSearch")).toHaveValue("gopshort");
  });
});
