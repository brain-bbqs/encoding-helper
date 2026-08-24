// The demos page: an alternative to the drop zone, at ?demos, listing the published demo set.
//
// The set (see lib/demoArchive.ts) is a couple of dozen files that each vary exactly one thing, so
// the page is laid out as a map of the set rather than a list of it: one card holding a grid of
// tiles, grouped by the thing being varied, and a second card under it showing whichever tile is
// pressed. The whole set is then visible at once, and comparing two files — a short GOP against a
// long one, say, which is what the set is built around — is a click rather than a scroll.
//
// It replaces the drop zone rather than sitting beside it, which is what makes it a page and not a
// panel: while it is up, the file picker, the URL box and any loaded file's tabs are all out of the
// way, and picking a demo puts them back with that file loaded.

import {
  DEMO_GROUPS,
  EMBER_DANDISET,
  fetchDemoDescription,
  fetchDemoSet,
  type DemoFile,
  type DemoSet,
} from "../lib/demoArchive";
import { h } from "../lib/dom";
import { fmtBytes } from "../lib/format";
import { readDemosFromUrl, writeDemosToUrl } from "../lib/appUrl";
import type { AppElements } from "./elements";

/** What the page needs of the file loader: somewhere to send the demo it was asked to open. */
export interface DemoLoader {
  loadUrl(url: string, name?: string): Promise<void>;
}

/** How the grid is narrowed, and what happens when the card's open button is pressed. */
export interface DemoBrowserOptions {
  search: string;
  onOpen: (demo: DemoFile) => void;
}

function headingOf(groupId: string): { title: string; blurb: string } {
  return DEMO_GROUPS.find((g) => g.ids.includes(groupId)) ?? { title: groupId, blurb: "" };
}

function matchesFilter(demo: DemoFile, search: string): boolean {
  if (!search) return true;
  const needle = search.toLowerCase();
  return [demo.title, demo.session, demo.group, demo.ext].some((s) => s.toLowerCase().includes(needle));
}

/** The extension, the size, and the warning for a file the MP4 parser cannot open. */
function metaFor(demo: DemoFile, withBadge: boolean): HTMLSpanElement {
  const meta = h("span", "demo-meta");
  meta.append(h("span", "demo-ext", demo.ext.toUpperCase()));
  if (demo.size) meta.append(h("span", "demo-size", fmtBytes(demo.size)));
  if (withBadge && !demo.loadsInApp) {
    const badge = h("span", "badge bad demo-badge", "MP4 parser can't open this");
    badge.title = "mp4box.js reads MP4 and MOV only, so opening this file lands on the error path.";
    meta.append(badge);
  }
  return meta;
}

/**
 * Draws the demo browser into `container`: the card, then the tiles that fill it.
 *
 * Exported for the unit tests, which is also why it takes everything it needs rather than reading
 * the page's own controls.
 */
export function renderDemoBrowser(container: HTMLElement, set: DemoSet, opts: DemoBrowserOptions): void {
  const shown = set.demos.filter((d) => matchesFilter(d, opts.search));
  // The grid is what the page is; the card under it is what the grid was pressed for, so it reads
  // as the answer to the tile above rather than as a header the grid explains.
  const grid = h("div", "section demos-grid");
  const card = h("div", "section demo-card");
  container.replaceChildren(grid, card);

  // Descriptions normally ride in the set's index. Only a dataset generated before that carried
  // them leaves one to fetch, and then only for the file actually being looked at — kept here so
  // pressing back and forth between two tiles costs one request each, not one per press.
  const fetched = new Map<string, string>();
  const tiles: HTMLButtonElement[] = [];

  const show = (demo: DemoFile): void => {
    for (const tile of tiles) tile.setAttribute("aria-pressed", String(tile.dataset.session === demo.session));
    card.dataset.session = demo.session;
    const head = h("div", "demo-head");
    head.append(h("h3", "demo-title", demo.title), metaFor(demo, true));

    const description = demo.description ?? fetched.get(demo.session) ?? null;
    const desc = h("p", "demo-desc", description ?? "");
    if (description === null) {
      fetchDemoDescription(demo)
        .then((text) => {
          if (!text) return;
          fetched.set(demo.session, text);
          // Only if this demo is still the one on screen; a fast click elsewhere wins.
          if (card.dataset.session === demo.session) desc.textContent = text;
        })
        .catch((err: unknown) => console.warn("[encoding-helper] could not read a demo sidecar:", err));
    }

    const actions = h("div", "demo-actions");
    const open = h("button", "btn sm demo-open", demo.loadsInApp ? "Open in the app" : "Open it anyway");
    open.type = "button";
    open.addEventListener("click", () => opts.onOpen(demo));
    const download = h("a", "btn sm sec demo-download", "Download");
    download.href = demo.videoUrl;
    download.download = demo.fileName;
    download.rel = "noopener";
    actions.append(open, download);

    card.replaceChildren(head, desc, actions);
  };

  if (shown.length === 0) {
    grid.replaceChildren(h("p", "demos-empty", "No demo file matches that filter."));
    card.remove();
    return;
  }

  let current: string | null = null;
  let row = h("div", "demo-tiles");
  for (const demo of shown) {
    const heading = headingOf(demo.group);
    if (heading.title !== current) {
      current = heading.title;
      const group = h("div", "demos-group");
      group.append(h("h2", null, heading.title));
      if (heading.blurb) group.append(h("p", "demos-group-blurb", heading.blurb));
      row = h("div", "demo-tiles");
      group.append(row);
      grid.append(group);
    }
    const tile = h("button", "demo-tile");
    tile.type = "button";
    tile.dataset.session = demo.session;
    tile.setAttribute("aria-pressed", "false");
    tile.append(h("span", "demo-tile-name", demo.title), metaFor(demo, false));
    if (!demo.loadsInApp) {
      const mark = h("span", "demo-tile-mark");
      mark.title = "mp4box.js reads MP4 and MOV only, so opening this file lands on the error path.";
      mark.setAttribute("aria-label", "The MP4 parser can't open this");
      tile.append(mark);
    }
    tile.addEventListener("click", () => show(demo));
    tiles.push(tile);
    row.append(tile);
  }

  // The card always has something in it, so the page never opens on an empty frame under the grid.
  // The first tile is the source recording, which is where the set starts.
  show(shown[0]);
}

function errorBox(err: unknown, retry: () => void): HTMLElement {
  const box = h("div", "section demos-error");
  box.append(h("h2", null, "Could not read the demo set"));
  box.append(h("p", "demos-error-why", err instanceof Error ? err.message : String(err)));
  box.append(
    h(
      "p",
      "demos-error-hint",
      `The demo files live on EMBER dandiset ${EMBER_DANDISET}, so this page needs to reach the archive. ` +
        "A file already on this machine can still be opened from the file picker.",
    ),
  );
  const again = h("button", "btn sm", "Try again");
  again.type = "button";
  again.addEventListener("click", retry);
  box.append(again);
  return box;
}

export function initDemosPage(els: AppElements, loader: DemoLoader): void {
  const page = els.demosPage;
  let built = false;
  let set: DemoSet | null = null;
  let browser: HTMLElement | null = null;
  let search = "";
  // #app is shown by the file loader once a file has been parsed; the demos page hides it while it
  // is up and puts back whatever it found rather than deciding for itself.
  let appDisplay: string | null = null;

  const close = (push: boolean): void => {
    if (page.style.display === "none") return;
    writeDemosToUrl(false, push);
    page.style.display = "none";
    els.dropZone.style.display = "";
    if (appDisplay !== null) els.app.style.display = appDisplay;
    appDisplay = null;
  };

  const onOpen = (demo: DemoFile): void => {
    // Closed first, so the drop zone's own "Reading file…" progress is what is on screen while the
    // demo downloads rather than the page it was picked from.
    close(false);
    void loader.loadUrl(demo.videoUrl, demo.fileName);
  };

  const rerender = (): void => {
    if (browser && set) renderDemoBrowser(browser, set, { search, onOpen });
  };

  const load = (): void => {
    const target = browser;
    if (!target) return;
    target.replaceChildren(h("p", "demos-loading", "Reading the demo set from the archive…"));
    fetchDemoSet()
      .then((fetched) => {
        set = fetched;
        rerender();
      })
      .catch((err: unknown) => {
        target.replaceChildren(errorBox(err, load));
      });
  };

  const searchBox = (): HTMLInputElement => {
    const box = h("input", "demos-search");
    box.type = "search";
    box.id = "demoSearch";
    box.placeholder = "Filter by name, group or extension…";
    box.setAttribute("aria-label", "Filter demo files");
    box.addEventListener("input", () => {
      search = box.value.trim();
      rerender();
    });
    return box;
  };

  const build = (): void => {
    if (built) return;
    built = true;
    const head = h("div", "demos-head");
    const back = h("button", "btn sec demos-back", "← Back to the file picker");
    back.type = "button";
    back.id = "demosBackBtn";
    back.addEventListener("click", () => close(true));
    head.append(h("h1", "demos-title", "Demo files"), back);

    browser = h("div", "demos-browser");
    page.replaceChildren(head, searchBox(), browser);
    load();
  };

  const open = (push: boolean): void => {
    writeDemosToUrl(true, push);
    build();
    els.dropZone.style.display = "none";
    if (appDisplay === null) appDisplay = els.app.style.display;
    els.app.style.display = "none";
    page.style.display = "block";
    window.scrollTo({ top: 0 });
  };

  els.browseDemosBtn.addEventListener("click", (e) => {
    // The drop zone under the button is itself a click target for the file picker.
    e.stopPropagation();
    open(true);
  });

  window.addEventListener("popstate", () => {
    if (readDemosFromUrl()) open(false);
    else close(false);
  });

  if (readDemosFromUrl()) open(false);
}
