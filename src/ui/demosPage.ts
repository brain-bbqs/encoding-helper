// The demos page: an alternative to the drop zone, at ?demos, listing the published demo set.
//
// The themed cards carry a heading and their tiles, nothing else: the only prose on the page is the
// description of one file, in the card that opens on a tile, and that card carries a notch on its
// top edge lined up with the tile it came from, so what the description is about is the thing the
// notch points at.
//
// The set (see lib/demoArchive.ts) is a couple of dozen files that each vary exactly one thing, so
// the page is laid out as a map of the set rather than a list of it: a card per theme holding that
// theme's tiles, and one detail card that moves to sit directly under whichever theme was pressed.
// The whole set is then visible at once, comparing two files — a short GOP against a long one, say,
// which is what the set is built around — is a click rather than a scroll, and what the click did
// is always next to the tile that did it rather than at the far end of the page.
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

/**
 * Re-aims the open card's notch after a resize.
 *
 * One window listener for the page rather than one per render: renderDemoBrowser runs on every
 * keystroke in the filter box, and a listener added there would pile up a copy per keystroke.
 */
let aimNotch: (() => void) | null = null;
let notchListenerBound = false;

function bindNotchListener(): void {
  if (notchListenerBound) return;
  notchListenerBound = true;
  window.addEventListener("resize", () => aimNotch?.());
}

/**
 * The heading a group's files appear under, and the key that colours it.
 *
 * The key is the heading's first group name, which is stable and unique across the table, so the
 * stylesheet can give every theme a hue of its own without the two lists having to agree on
 * anything but that name. A group no heading covers falls back to its own name for both.
 */
function headingOf(groupId: string): { title: string; key: string } {
  const heading = DEMO_GROUPS.find((g) => g.ids.includes(groupId));
  return heading ? { title: heading.title, key: heading.ids[0] } : { title: groupId, key: groupId };
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
  const grid = h("div", "demos-grid");
  // One card, moved under the theme whose tile was pressed rather than parked at either end of the
  // page: with a themed card per group the grid is tall, and a detail panel the reader has to go
  // looking for is a detail panel they do not see change.
  const card = h("div", "section demo-card");
  container.replaceChildren(grid);

  // Descriptions normally ride in the set's index. Only a dataset generated before that carried
  // them leaves one to fetch, and then only for the file actually being looked at — kept here so
  // pressing back and forth between two tiles costs one request each, not one per press.
  const fetched = new Map<string, string>();
  const tiles: HTMLButtonElement[] = [];

  /** The themed card each session's tile sits in, so the detail card can follow the selection. */
  const groupOfSession = new Map<string, HTMLElement>();

  /**
   * Points the card's notch at a tile, in pixels from the card's left edge.
   *
   * Kept a whole notch-width clear of either corner, since a tile in the first or last column would
   * otherwise put the point past the rounded edge it is meant to grow out of. In a layout engine
   * that has not measured anything (jsdom, and the moment before first paint) every rectangle is
   * zero-width, and the notch keeps whatever position it already had.
   */
  const aimAt = (tile: HTMLElement): void => {
    const tileBox = tile.getBoundingClientRect();
    const cardBox = card.getBoundingClientRect();
    if (cardBox.width <= 0) return;
    const centre = tileBox.left + tileBox.width / 2 - cardBox.left;
    card.style.setProperty("--notch-x", `${Math.min(Math.max(centre, 20), cardBox.width - 20)}px`);
  };

  const show = (demo: DemoFile): void => {
    for (const tile of tiles) tile.setAttribute("aria-pressed", String(tile.dataset.session === demo.session));
    const group = groupOfSession.get(demo.session);
    group?.after(card);
    card.dataset.session = demo.session;
    // The card takes the colour of the theme it has moved under, so it reads as part of that block
    // rather than as a panel that happens to be parked there.
    card.dataset.hue = group?.dataset.hue ?? "";
    const pressed = tiles.find((t) => t.dataset.session === demo.session);
    if (pressed) {
      aimAt(pressed);
      aimNotch = () => aimAt(pressed);
      bindNotchListener();
    }
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

    // The description and the buttons share a row, so a card as wide as the grid above it has
    // content at both edges rather than a column of text against a lot of empty right-hand side.
    const body = h("div", "demo-body");
    body.append(desc, actions);
    card.replaceChildren(head, body);
  };

  if (shown.length === 0) {
    grid.replaceChildren(h("p", "section demos-empty", "No demo file matches that filter."));
    card.remove();
    return;
  }

  let current: string | null = null;
  let row = h("div", "demo-tiles");
  let group = h("section", "section demos-group");
  for (const demo of shown) {
    const heading = headingOf(demo.group);
    if (heading.title !== current) {
      current = heading.title;
      group = h("section", "section demos-group");
      group.dataset.hue = heading.key;
      group.append(h("h2", null, heading.title));
      row = h("div", "demo-tiles");
      group.append(row);
      grid.append(group);
    }
    groupOfSession.set(demo.session, group);
    // What the theme asks for on its row: room for its own files, side by side. Flexbox then
    // shrinks the greedy ones until the row fits, wrapping their tiles rather than pushing a small
    // theme onto a line of its own — which is what packs the set into a screen rather than a scroll.
    group.style.setProperty("--tiles", String(row.childElementCount + 1));
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

  // The card always has something in it, so the page never opens with nothing selected. The first
  // tile is the source recording, which is where the set starts.
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
