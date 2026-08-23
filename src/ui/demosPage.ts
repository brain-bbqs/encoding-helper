// The demos page: an alternative to the drop zone, at ?demos, listing the published demo set.
//
// The set (see lib/demoArchive.ts) is a couple of dozen files that each vary exactly one thing, so
// the page is a browsing surface rather than a picker: grouped by the thing being varied, one fold
// per file, and a filter across the lot. A fold's prose and figures come from that file's own
// sidecar, fetched the first time it is opened, so arriving on the page costs two requests however
// many demos there are.
//
// It replaces the drop zone rather than sitting beside it, which is what makes it a page and not a
// panel: while it is up, the file picker, the URL box and any loaded file's tabs are all out of the
// way, and picking a demo puts them back with that file loaded.

import {
  DEMO_GROUPS,
  EMBER_DANDISET,
  EMBER_DANDISET_URL,
  fetchDemoDetails,
  fetchDemoSet,
  type DemoFile,
  type DemoSet,
} from "../lib/demoArchive";
import { h } from "../lib/dom";
import { fmtBytes, fmtDur, fmtRate } from "../lib/format";
import { readDemosFromUrl, writeDemosToUrl } from "../lib/appUrl";
import type { AppElements } from "./elements";

/** What the page needs of the file loader: somewhere to send the demo it was asked to open. */
export interface DemoLoader {
  loadUrl(url: string, name?: string): Promise<void>;
}

/** How the list is narrowed, and what happens when a card's open button is pressed. */
export interface DemoListOptions {
  search: string;
  /** Hides the Matroska/WebM/AVI files, which are in the set to fail the MP4 parse on purpose. */
  loadableOnly: boolean;
  onOpen: (demo: DemoFile) => void;
}

function groupOf(id: string): { title: string; blurb: string } {
  return DEMO_GROUPS.find((g) => g.id === id) ?? { title: id, blurb: "" };
}

function matchesFilter(demo: DemoFile, opts: DemoListOptions): boolean {
  if (opts.loadableOnly && !demo.loadsInApp) return false;
  if (!opts.search) return true;
  const needle = opts.search.toLowerCase();
  return [demo.title, demo.session, demo.group, demo.ext].some((s) => s.toLowerCase().includes(needle));
}

function factsGrid(facts: { label: string; value: string }[]): HTMLDivElement {
  const grid = h("div", "grid demo-facts");
  for (const { label, value } of facts) {
    const item = h("div", "item");
    item.append(h("label", null, label), h("div", "val sm", value));
    grid.append(item);
  }
  return grid;
}

/** The figures a sidecar carries, each left out when it does not carry that one. */
async function readFacts(
  demo: DemoFile,
): Promise<{ description: string | null; facts: { label: string; value: string }[] }> {
  const facts = [{ label: "Session", value: demo.session }];
  const details = await fetchDemoDetails(demo);
  if (details.duration != null) facts.push({ label: "Duration", value: fmtDur(details.duration) });
  if (details.width != null && details.height != null) {
    facts.push({ label: "Resolution", value: `${details.width} × ${details.height}` });
  }
  if (details.frameRate != null) facts.push({ label: "Frame rate", value: `${fmtRate(details.frameRate)} fps` });
  if (details.frameCount != null) facts.push({ label: "Frames", value: String(details.frameCount) });
  if (details.codec != null) facts.push({ label: "Codec", value: details.codec });
  if (details.codecString != null) facts.push({ label: "Codec string", value: details.codecString });
  if (details.pixelFormat != null) facts.push({ label: "Pixel format", value: details.pixelFormat });
  if (details.bitDepth != null) facts.push({ label: "Bit depth", value: `${details.bitDepth} bit` });
  return { description: details.description, facts };
}

/** Fills a fold's detail block, once, the first time it is opened. */
async function fillDetail(demo: DemoFile, detail: HTMLElement): Promise<void> {
  let description: string | null = null;
  let facts = [{ label: "Session", value: demo.session }];
  try {
    const read = await readFacts(demo);
    description = read.description;
    facts = read.facts;
  } catch (err) {
    // A missing or unreadable sidecar costs the prose and the figures, not the file: the buttons
    // that open and download it sit outside this block and are on screen from the moment the fold
    // opens, whether or not the sidecar ever answers.
    console.warn("[encoding-helper] could not read a demo sidecar:", err);
  }
  detail.replaceChildren();
  if (description) detail.append(h("p", "demo-desc", description));
  detail.append(factsGrid(facts));
  if (demo.ffmpegArgs) {
    detail.append(h("div", "demo-args-label", "Made with"));
    detail.append(h("pre", "demo-args", `ffmpeg ${demo.ffmpegArgs}`));
  }
}

function demoCard(demo: DemoFile, onOpen: (demo: DemoFile) => void): HTMLDetailsElement {
  const card = h("details", "demo-card");
  card.dataset.session = demo.session;

  const head = document.createElement("summary");
  head.className = "demo-head";
  head.append(h("span", "demo-title", demo.title));
  const meta = h("span", "demo-meta");
  meta.append(h("span", "demo-ext", demo.ext.toUpperCase()));
  if (demo.size) meta.append(h("span", "demo-size", fmtBytes(demo.size)));
  if (!demo.loadsInApp) {
    const badge = h("span", "badge bad demo-badge", "MP4 parser can't open this");
    badge.title = "mp4box.js reads MP4 and MOV only, so opening this file lands on the error path.";
    meta.append(badge);
  }
  head.append(meta);

  const body = h("div", "demo-body");
  // The prose and the figures are read from the archive on first open; the buttons are on screen
  // from that same moment, so picking a file never waits on a sidecar.
  const detail = h("div", "demo-detail");
  detail.append(h("p", "demo-loading", "Reading this file's sidecar…"));

  const actions = h("div", "demo-actions");
  const open = h("button", "btn sm demo-open", demo.loadsInApp ? "Open in the app" : "Open it anyway");
  open.type = "button";
  open.addEventListener("click", () => onOpen(demo));
  const download = h("a", "btn sm sec demo-download", "Download");
  download.href = demo.videoUrl;
  download.download = demo.fileName;
  download.rel = "noopener";
  actions.append(open, download);

  body.append(detail, actions);

  let filled = false;
  card.addEventListener("toggle", () => {
    if (!card.open || filled) return;
    filled = true;
    void fillDetail(demo, detail);
  });

  card.append(head, body);
  return card;
}

/**
 * Draws the filtered set into `container`, one card per file under a heading per group.
 *
 * Exported for the unit tests, which is also why it takes everything it needs rather than reading
 * the page's own controls.
 */
export function renderDemoList(container: HTMLElement, set: DemoSet, opts: DemoListOptions): void {
  container.replaceChildren();
  const shown = set.demos.filter((d) => matchesFilter(d, opts));
  if (shown.length === 0) {
    container.append(h("p", "demos-empty", "No demo file matches that filter."));
    return;
  }
  let current: string | null = null;
  let list = h("div", "demo-list");
  for (const demo of shown) {
    if (demo.group !== current) {
      current = demo.group;
      const { title, blurb } = groupOf(demo.group);
      const section = h("section", "section demos-group");
      section.append(h("h2", null, title));
      if (blurb) section.append(h("p", "demos-group-blurb", blurb));
      list = h("div", "demo-list");
      section.append(list);
      container.append(section);
    }
    list.append(demoCard(demo, opts.onOpen));
  }
}

/** Where the set came from, once it has been read: the dandiset, the recording, the licence. */
function provenanceLine(set: DemoSet): HTMLParagraphElement {
  const link = (text: string, href: string): HTMLAnchorElement => {
    const a = h("a", "demos-link", text);
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener";
    return a;
  };
  const p = h("p", "demos-provenance");
  p.append(`${set.demos.length} files on EMBER dandiset ${EMBER_DANDISET} · `);
  p.append(link("view on the archive", EMBER_DANDISET_URL));
  if (set.source?.name) {
    p.append(" · encoded from ");
    p.append(set.source.url ? link(set.source.name, set.source.url) : set.source.name);
  }
  if (set.license) p.append(` · ${set.license}`);
  return p;
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
  let groups: HTMLElement | null = null;
  let provenance: HTMLElement | null = null;
  let search = "";
  let loadableOnly = false;
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
    // demo downloads rather than the list it was picked from.
    close(false);
    void loader.loadUrl(demo.videoUrl, demo.fileName);
  };

  const rerender = (): void => {
    if (groups && set) renderDemoList(groups, set, { search, loadableOnly, onOpen });
  };

  const load = (): void => {
    const target = groups;
    if (!target) return;
    target.replaceChildren(h("p", "demos-loading", "Reading the demo set from the archive…"));
    fetchDemoSet()
      .then((fetched) => {
        set = fetched;
        provenance?.replaceChildren(provenanceLine(fetched));
        rerender();
      })
      .catch((err: unknown) => {
        target.replaceChildren(errorBox(err, load));
      });
  };

  const controls = (): HTMLDivElement => {
    const row = h("div", "demos-controls");
    const box = h("input", "demos-search");
    box.type = "search";
    box.id = "demoSearch";
    box.placeholder = "Filter by name, group or extension…";
    box.setAttribute("aria-label", "Filter demo files");
    box.addEventListener("input", () => {
      search = box.value.trim();
      rerender();
    });

    const onlyLabel = h("label", "demos-only");
    const only = h("input", "switch");
    only.type = "checkbox";
    only.id = "demoLoadableOnly";
    only.addEventListener("change", () => {
      loadableOnly = only.checked;
      rerender();
    });
    onlyLabel.append(only, h("span", null, "Only files this app can open"));

    const setAllOpen = (open: boolean): void => {
      groups?.querySelectorAll<HTMLDetailsElement>("details.demo-card").forEach((d) => (d.open = open));
    };
    const expand = h("button", "btn sm sec", "Expand all");
    expand.type = "button";
    expand.addEventListener("click", () => setAllOpen(true));
    const collapse = h("button", "btn sm sec", "Collapse all");
    collapse.type = "button";
    collapse.addEventListener("click", () => setAllOpen(false));

    row.append(box, onlyLabel, h("span", "demos-spacer"), expand, collapse);
    return row;
  };

  const build = (): void => {
    if (built) return;
    built = true;
    const head = h("div", "demos-head");
    const heading = h("div", "demos-heading");
    heading.append(h("h1", "demos-title", "Demo files"));
    heading.append(
      h(
        "p",
        "demos-sub",
        "One file per idea this app can show you, each changing exactly one thing from the reference encode.",
      ),
    );
    const back = h("button", "btn sec demos-back", "← Back to the file picker");
    back.type = "button";
    back.id = "demosBackBtn";
    back.addEventListener("click", () => close(true));
    head.append(heading, back);

    groups = h("div", "demos-groups");
    provenance = h("div", "demos-provenance-slot");
    page.replaceChildren(head, provenance, controls(), groups);
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
