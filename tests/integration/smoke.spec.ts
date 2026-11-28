import { test, expect } from "@playwright/test";
import { FIXTURE_SECONDS } from "../fixtures/demoVideo";
import { gotoDemos, loadDemo, openReferenceDemo, REFERENCE_FILE_NAME } from "./demoArchive";

/** Where the app is published, which the Full Analysis document links to. */
const APP_ADDRESS = "https://encoding-helper.brain-bbqs.org";

test.describe("Encoding Helper shell", () => {
  test("renders the drop zone and hides the tabbed app until a file is loaded", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/Encoding Helper/);
    await expect(page.locator("#dropZone")).toBeVisible();
    await expect(page.locator("#app")).toBeHidden();
  });

  // A click on the zone itself opens nothing: its buttons are the way in.
  test("does not draw the drop zone as something to click", async ({ page }) => {
    await page.goto("/");
    const cursor = await page.locator("#dropZone").evaluate((zone) => getComputedStyle(zone).cursor);
    expect(cursor).toBe("auto");
  });

  test("loading a demo file reveals the tabbed app", async ({ page }) => {
    await loadDemo(page);
    await expect(page.locator("#app")).toBeVisible();
    await expect(page.locator(".tab.on")).toContainText("Inspect");
    await expect(page.locator("#panel-inspect")).not.toBeEmpty();
  });

  test("frames the page with the BBQS, CON, and Talmo Lab watermarks", async ({ page }) => {
    // Wide enough that the corner watermarks stay in their fixed, viewport-anchored spots instead
    // of the narrow-screen fallback (see the max-width: 1560px query in style.css) that hides the
    // BBQS mark and flows the footer bar into the page to avoid overlapping content.
    await page.setViewportSize({ width: 1680, height: 900 });
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/");

    const bbqsLink = page.locator('a.brand-watermark-link[href="https://brain-bbqs.org"]');
    await expect(bbqsLink).toBeVisible();
    await expect(page.locator(".brand-watermark-logo")).toBeVisible();

    const versionLink = page.locator("#version-indicator");
    await expect(versionLink).toHaveText(/^v\d+\.\d+\.\d+$/);
    await expect(versionLink).toHaveAttribute("href", "https://github.com/brain-bbqs/encoding-helper");

    const conLink = page.locator('a.footer-brand-link[href="https://centerforopenneuroscience.org"]');
    const talmoLink = page.locator('a.footer-brand-link.captioned[href="https://talmolab.org/"]');
    await expect(conLink).toBeVisible();
    await expect(talmoLink).toBeVisible();
    await expect(talmoLink.locator(".footer-brand-name")).toHaveText("Talmo Lab");
    // Only the variant matching the active theme is rendered.
    await expect(talmoLink.locator(".footer-brand-logo.on-light")).toBeVisible();
    await expect(talmoLink.locator(".footer-brand-logo.on-dark")).toBeHidden();

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
    await expect(page.locator(".footer-brand-link.captioned .footer-brand-logo.on-dark")).toBeVisible();
    await expect(page.locator(".footer-brand-link.captioned .footer-brand-logo.on-light")).toBeHidden();
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
    // where the map is now a section. The rewrite happens with the demos page up, and leaves the
    // flag as it was typed.
    await gotoDemos(page, "&tab=atoms");
    expect(new URL(page.url()).search).toBe("?demos&tab=inspect");
    await openReferenceDemo(page);
    await expect(page).toHaveURL(/tab=inspect/);
    const panel = page.locator("#panel-inspect");
    await expect(panel.locator(".atom-map")).toBeVisible();
    await expect(panel.locator(".atom-block.grouped")).toHaveCount(0);
    const drawn = await panel.locator(".atom-block").count();

    // The breadcrumb counts the boxes the layout covers, including any swallowed by a group block,
    // so matching it against the blocks actually drawn is what catches boxes going missing.
    const covered = /(\d[\d,]*) box/.exec((await panel.locator(".crumb-range").textContent()) ?? "");
    expect(drawn).toBe(Number((covered?.[1] ?? "0").replace(/,/g, "")));

    // The document draws that same map, block for block: it is the whole of what it says about the
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
    // has no box to measure, so wait for it to be on screen before asking where it is.
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

  // jsdom loads no frame and lays nothing out, so only a browser can say the frame comes back at
  // the document's height: after a switch, and after a visit that built the panel, and so loaded
  // the frame, while the Markdown view hid it. At phone width, where the Markdown's longer lines
  // have to scroll inside the view rather than widen the page.
  test("swaps the document for its Markdown and back, the frame keeping the document's height", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.setViewportSize({ width: 375, height: 800 });
    await loadDemo(page);
    await page.locator(".tab-action").click();

    const frame = page.locator("#analysisDoc");
    const doc = page.frameLocator("#analysisDoc");
    const rendered = page.getByRole("tab", { name: "Rendered" });
    const markdown = page.getByRole("tab", { name: "Markdown" });
    // Inside the frame's border, which is the room the document has.
    const frameHeight = (): Promise<number> => frame.evaluate((f: HTMLIFrameElement) => f.clientHeight);
    const documentHeight = (): Promise<number> =>
      frame.evaluate((f: HTMLIFrameElement) => f.contentDocument!.body.scrollHeight);

    await expect(doc.locator(".doc-head h1")).toHaveText(REFERENCE_FILE_NAME);
    await expect(rendered).toHaveAttribute("aria-selected", "true");
    await expect.poll(frameHeight).toBeGreaterThan(1000);
    const fitted = await frameHeight();
    expect(fitted).toBe(await documentHeight());

    await markdown.click();
    await expect(markdown).toHaveAttribute("aria-selected", "true");
    await expect(frame).toBeHidden();
    const raw = page.getByRole("tabpanel", { name: "Markdown" });
    await expect(raw).toBeVisible();
    await page.getByRole("button", { name: "Copy Markdown" }).click();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied.startsWith(`# Encoding Helper analysis: ${REFERENCE_FILE_NAME}\n`)).toBe(true);
    expect(copied).toContain("\n## Video Track\n");
    // innerText is the text as laid out, so it only matches line for line if whitespace is kept.
    expect(await raw.innerText()).toBe(copied);
    const widths = await raw.evaluate((el) => ({
      view: el.clientWidth,
      content: el.scrollWidth,
      page: document.documentElement.scrollWidth,
      viewport: document.documentElement.clientWidth,
    }));
    expect(widths.content).toBeGreaterThan(widths.view);
    expect(widths.page).toBe(widths.viewport);

    await rendered.click();
    await expect(frame).toBeVisible();
    await expect.poll(frameHeight).toBe(fitted);

    await markdown.click();
    await page.locator('.tab[data-tab="inspect"]').click();
    await page.locator(".tab-action").click();
    await expect(markdown).toHaveAttribute("aria-selected", "true");
    await expect(frame).toBeHidden();
    await expect(doc.locator(".doc-head h1")).toHaveText(REFERENCE_FILE_NAME);
    await rendered.click();
    await expect(frame).toBeVisible();
    // Against the new document rather than the first: its timestamp is a different width, which at
    // this width can move where the line under the title wraps.
    await expect.poll(frameHeight).toBe(await documentHeight());
    expect(await frameHeight()).toBeGreaterThan(1000);
  });

  // jsdom lays nothing out and loads no frame, so only a browser can say the frame gives the document
  // exactly its height, follows it down as well as up without moving the page, and keeps both of
  // the document's kinds of link from loading the app inside it.
  test("fits the preview frame to its document, and keeps the document's links from navigating it", async ({
    page,
    context,
  }) => {
    // The document names the published app, which this run has no business fetching.
    await context.route(`${APP_ADDRESS}/**`, (route) =>
      route.fulfill({ status: 200, contentType: "text/html", body: "<title>Encoding Helper</title>" }),
    );
    await page.setViewportSize({ width: 375, height: 800 });
    await loadDemo(page);
    await page.locator(".tab-action").click();
    const frame = page.locator("#analysisDoc");
    const doc = page.frameLocator("#analysisDoc");
    await expect(doc.locator(".doc-head h1")).toHaveText(REFERENCE_FILE_NAME);
    const fit = (): Promise<{ room: number; needs: number; scrolls: boolean; address: string }> =>
      frame.evaluate((f: HTMLIFrameElement) => {
        const d = f.contentDocument!;
        return {
          room: f.clientHeight,
          needs: d.body.scrollHeight,
          scrolls: d.documentElement.scrollHeight > d.documentElement.clientHeight,
          address: f.contentWindow!.location.href,
        };
      });
    const fitted = async (): Promise<boolean> => {
      const { room, needs, scrolls } = await fit();
      return room === needs && !scrolls;
    };

    await expect.poll(fitted).toBe(true);
    const narrow = (await fit()).room;
    // Wider, the document reflows shorter, and the frame has to come down with it.
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect.poll(fitted).toBe(true);
    const wide = (await fit()).room;
    expect(wide).toBeLessThan(narrow);

    // A refit while the reader is part-way down leaves them where they were.
    await page.evaluate(() => window.scrollTo(0, 1500));
    await frame.evaluate((f: HTMLIFrameElement) => {
      const more = f.contentDocument!.createElement("div");
      more.style.height = "40px";
      f.contentDocument!.body.append(more);
    });
    await expect.poll(async () => (await fit()).room).toBe(wide + 40);
    expect(await page.evaluate(() => window.scrollY)).toBe(1500);

    // A Contents entry brings its section into view, with the document still in the frame.
    await page.evaluate(() => window.scrollTo(0, 0));
    await doc.locator('.doc-toc a[href="#mp4-atom-map"]').click();
    await expect
      .poll(() =>
        frame.evaluate(
          (f: HTMLIFrameElement) =>
            f.getBoundingClientRect().top +
            f.contentDocument!.querySelector("#mp4-atom-map h2")!.getBoundingClientRect().top,
        ),
      )
      .toBeLessThan(100);
    expect((await fit()).address).toBe("about:srcdoc");
    await expect(doc.locator(".doc-head h1")).toHaveText(REFERENCE_FILE_NAME);

    // The app link opens a tab of its own.
    const [opened] = await Promise.all([context.waitForEvent("page"), doc.locator(".doc-meta a").click()]);
    await opened.waitForLoadState();
    expect(opened.url()).toBe(`${APP_ADDRESS}/`);
    expect(await opened.evaluate(() => window.opener)).toBeNull();
    await opened.close();
    expect((await fit()).address).toBe("about:srcdoc");
  });

  // The view tabs borrow the main tabs' look, so they have to shrink with them on a phone too
  // rather than come out larger than the bar above them.
  test("sizes the Rendered and Markdown tabs like the main tabs, on a phone and on a desktop", async ({ page }) => {
    await loadDemo(page);
    await page.locator(".tab-action").click();
    await expect(page.getByRole("tab", { name: "Markdown" })).toBeVisible();
    const sizes = (): Promise<{ main: string[]; view: string[] }> =>
      page.evaluate(() => {
        const size = (tab: Element, list: Element): string[] => {
          const t = getComputedStyle(tab);
          return [
            t.paddingTop,
            t.paddingRight,
            t.paddingBottom,
            t.paddingLeft,
            t.fontSize,
            getComputedStyle(list).columnGap,
          ];
        };
        const view = document.querySelector('[role="tablist"][aria-label="Document view"]')!;
        return {
          main: size(document.querySelector(".tabs .tab")!, document.querySelector(".tabs")!),
          view: size(view.querySelector('[role="tab"]')!, view),
        };
      });

    for (const width of [375, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      const { main, view } = await sizes();
      expect(view, `at ${width}px`).toEqual(main);
    }
  });

  test("adds the seeking test to the document once it has been run", async ({ page }) => {
    // The seeking test is a section of Inspect; its old tab name still points at it.
    await loadDemo(page, "&tab=seek");
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

  // The switch changes one class on <html>, which the stylesheet reads; the tabs are not drawn
  // again, so a node marked before the flip is still there after it.
  test("hides the teaching material from the header switch without drawing the tabs again", async ({ page }) => {
    await loadDemo(page);
    const panel = page.locator("#panel-inspect");
    const teach = panel.locator(".teach").first();
    const info = panel.locator(".item-head .info").first();
    await expect(teach).toBeVisible();
    await expect(info).toBeVisible();
    await panel
      .locator(".section")
      .first()
      .evaluate((el) => el.setAttribute("data-kept", ""));

    const toggle = page.locator("#eduToggleSlot input.switch");
    await toggle.uncheck();
    await expect(teach).toBeHidden();
    await expect(info).toBeHidden();
    // `.info` also names the B-frames badge's colour (the demo has B-frames), which is a finding
    // rather than teaching.
    await expect(panel.locator(".badge.info")).toBeVisible();
    await expect(panel.locator(".section[data-kept]")).toHaveCount(1);
    expect(new URL(page.url()).searchParams.get("edu")).toBe("0");

    await toggle.check();
    await expect(teach).toBeVisible();
    await expect(info).toBeVisible();
  });

  // ffmpeg's output is logged at the "info" level, which is also the class the ⓘ wrapper's
  // inline-flex rule names. Specificity decides which rule a line takes, and jsdom goes by source
  // order alone, so only a real browser can check it. ffmpeg itself is not run: the lines are
  // written the way logLine writes them.
  test("puts each ffmpeg console line on a row of its own", async ({ page }) => {
    await loadDemo(page, "&tab=encode");
    const tops = await page
      .locator("#panel-encode .log-details")
      .first()
      .evaluate((wrap: HTMLDetailsElement) => {
        wrap.style.display = "";
        wrap.open = true;
        const log = wrap.querySelector(".log-console")!;
        for (const level of ["info", "info", "info", "success", "warn", "error"]) {
          const line = document.createElement("div");
          line.className = `l ${level}`;
          line.textContent = `ffmpeg says ${level}`;
          log.append(line);
        }
        return Array.from(log.children, (line) => Math.round(line.getBoundingClientRect().top));
      });
    expect(new Set(tops).size).toBe(6);
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

  // 1440 is the common laptop, and the page's own column takes the width there rather than leaving
  // the 220px a side the fixed marks need.
  test("drops the fixed watermarks once the viewport is too narrow to frame the page", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await expect(page.locator(".brand-watermark-link")).toBeHidden();
    // The remaining watermarks stay, but in normal document flow under the page content.
    await expect(page.locator(".footer-brands")).toBeVisible();
    await expect(page.locator(".page-footer-bar")).toHaveCSS("position", "static");
  });
});
