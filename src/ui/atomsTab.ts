// The atom map — the MP4 box tree laid on its side — as a section of the Inspect tab.
//
// Left to right across the file, each row down one level of nesting, so the map stays the same
// handful of lanes tall whether the video runs ten seconds or ten hours. Siblings split their
// parent's width by how many boxes each subtree holds, so every box gets room and nothing in the
// file goes unshown; see atomLayout.ts for why that particular split. Every block is a button
// carrying its own offset and size, so the numbers are reachable by keyboard and screen reader as
// well as by hovering. The Full Analysis document draws the same map through renderStaticAtomMap
// below, minus everything that needs a hand.

import { layoutAtoms, placeAtoms, placementRange, type AtomRect, type AxisRange } from "../lib/atomLayout";
import { h, teachBox } from "../lib/dom";
import { ATOM_MAP_READOUT_HINT, FASTSTART_EXPLAINER } from "../lib/explainers";
import { fmtBytes } from "../lib/format";
import { state } from "../lib/state";
import type { BoxNode } from "../lib/types";

/** What the boxes worth calling out actually hold, named in the readout. */
const BOX_ROLES: Record<string, string | undefined> = {
  ftyp: "brand",
  moov: "index",
  mdat: "sample data",
  moof: "fragment index",
  mfra: "fragment random access",
  free: "padding",
  skip: "padding",
};

/** The three box families the map colors; everything else shares the neutral slot. */
const FAMILIES: [string, string][] = [
  ["moov", "index & metadata"],
  ["mdat", "sample data"],
  ["moof", "fragment index"],
];

/**
 * Roughly what a label costs in the two sizes the blocks draw it at: per character, plus the
 * block's own padding. Measured against the map's real width, so a box still gets named in the
 * narrow slot a file with a big moov can afford it.
 */
const LABEL_COST = {
  wide: { perChar: 6.7, padding: 10 },
  snug: { perChar: 5.8, padding: 4 },
};

/**
 * Which of the two label sizes fits in a block this wide, or neither. In the panel this is
 * re-decided from the measured width on every resize; in the document it is decided once, from the
 * width the document will be read at, since nothing runs there to decide it later.
 */
function labelFit(frac: number, chars: number, widthPx: number): "wide" | "snug" | "" {
  const px = frac * widthPx;
  if (px >= chars * LABEL_COST.wide.perChar + LABEL_COST.wide.padding) return "wide";
  if (px >= chars * LABEL_COST.snug.perChar + LABEL_COST.snug.padding) return "snug";
  return "";
}

// One observer at a time: each redraw builds a fresh map element and re-points the observer at it.
let labelObserver: ResizeObserver | null = null;

function familyClass(family: string | null): string {
  return family !== null && FAMILIES.some(([key]) => key === family) ? "f-" + family : "f-other";
}

export function renderAtomMap(panel: HTMLElement): void {
  const sec = h("div", "section");
  sec.append(h("h2", null, "MP4 Box / Atom Structure"));
  // Faststart is a statement about where two of these boxes sit relative to each other, so it is
  // read here, against the map that draws them, rather than up in the file overview.
  sec.append(faststartBadge());

  const placements = placeAtoms(state.boxes);
  const zoom: { label: string; range: AxisRange }[] = [];
  const body = h("div");

  const draw = (): void => {
    body.innerHTML = "";
    if (state.boxes.length === 0) {
      body.append(h("div", "progress-label", "No boxes were parsed for this file."));
      return;
    }
    renderMap(body, placements, zoom, draw);
  };

  sec.append(body);
  // Only faststart is taught here. What the box tree is, the container overview already says; how
  // to read the map, the hint above it and the hover readout do.
  sec.append(teachBox(FASTSTART_EXPLAINER, "🚀"));
  panel.append(sec);
  draw();
}

/** Whether `moov` precedes `mdat`, the one fact about box order that decides how the file streams. */
function faststartBadge(): HTMLDivElement {
  const wrap = h("div", "atom-faststart");
  wrap.append(
    h("span", "badge " + (state.faststart ? "good" : "bad"), state.faststart ? "✓ Fast start" : "✗ Not fast start"),
  );
  return wrap;
}

function renderMap(
  host: HTMLElement,
  placements: ReturnType<typeof placeAtoms>,
  zoom: { label: string; range: AxisRange }[],
  redraw: () => void,
): void {
  const fullRange = placementRange(placements);
  const view = zoom.length > 0 ? zoom[zoom.length - 1].range : fullRange;
  const layout = layoutAtoms(placements, view);
  const shown = layout.rects.reduce((n, r) => n + r.count, 0);

  host.append(renderCrumbs(shown, zoom, redraw));

  const { map, lanes } = mapLanes(layout.laneCount);
  const readout = h("div", "atom-readout", ATOM_MAP_READOUT_HINT);
  layout.rects.forEach((rect) => lanes[rect.depth].append(blockEl(rect, view, zoom, redraw, readout)));
  host.append(map, readout);

  if (layout.truncated) {
    host.append(h("div", "progress-label", "This file nests further than the map draws; zoom in to see the rest."));
  }
  host.append(renderLegend(layout.rects));
  bindLabelSizing(map);
}

/** The lanes of a laid-out map, one per nesting level, ready to have blocks dropped into them. */
function mapLanes(laneCount: number): { map: HTMLDivElement; lanes: HTMLDivElement[] } {
  const map = h("div", "atom-map");
  const lanes: HTMLDivElement[] = [];
  for (let depth = 0; depth < laneCount; depth++) {
    const lane = h("div", "atom-lane");
    lanes.push(lane);
    map.append(lane);
  }
  return { map, lanes };
}

function positionBlock(el: HTMLElement, rect: AtomRect, label: string): void {
  el.style.left = rect.x * 100 + "%";
  el.style.width = rect.w * 100 + "%";
  el.dataset.frac = String(rect.w);
  el.dataset.chars = String(label.length);
  el.setAttribute("aria-label", rectDetail(rect));
  el.append(h("span", "lbl", label));
}

/**
 * The map as a picture rather than a control, for the Full Analysis document: the same lanes,
 * blocks, colors and legend, with the zoom, the breadcrumb and the hover readout left out — none of
 * them mean anything in a saved file. Each block keeps its detail as a `title`, which still works
 * on hover in the exported HTML and costs nothing on paper. `widthPx` is the width the map will be
 * read at, needed because the document runs no script to measure itself. Null for a file with no
 * boxes parsed (a non-MP4 container), where there is no tree to draw.
 */
export function renderStaticAtomMap(boxes: BoxNode[], widthPx: number): HTMLDivElement | null {
  if (boxes.length === 0) return null;
  const placements = placeAtoms(boxes);
  const layout = layoutAtoms(placements, placementRange(placements));
  const wrap = h("div");
  const { map, lanes } = mapLanes(layout.laneCount);
  layout.rects.forEach((rect) => {
    const label = rectLabel(rect);
    const fit = labelFit(rect.w, label.length, widthPx);
    const el = h(
      "div",
      `atom-block ${familyClass(rect.family)}${rect.kind === "group" ? " grouped" : ""}${fit ? " " + fit : ""}`,
    );
    el.title = rectDetail(rect);
    positionBlock(el, rect, label);
    lanes[rect.depth].append(el);
  });
  wrap.append(map, renderLegend(layout.rects));
  return wrap;
}

function renderCrumbs(shown: number, zoom: { label: string; range: AxisRange }[], redraw: () => void): HTMLDivElement {
  const crumbs = h("div", "atom-crumbs");
  crumbs.setAttribute("aria-label", "Zoom path");
  // Each crumb pops the zoom path back to the depth it names; the last one is where you already are.
  const jump = (depth: number, label: string): HTMLButtonElement => {
    const btn = h("button", "crumb" + (depth === zoom.length ? " on" : ""), label);
    btn.type = "button";
    btn.addEventListener("click", () => {
      zoom.length = depth;
      redraw();
    });
    return btn;
  };
  crumbs.append(jump(0, "Whole file"));
  zoom.forEach((step, i) => crumbs.append(h("span", "crumb-sep", "›"), jump(i + 1, step.label)));
  crumbs.append(h("span", "crumb-range", `${boxCount(shown)} shown`));
  return crumbs;
}

function boxCount(n: number): string {
  return `${n.toLocaleString()} box${n === 1 ? "" : "es"}`;
}

/** Rounded size with the exact byte count behind it, except under 1 KB where they are the same. */
function fmtSize(bytes: number): string {
  const rounded = fmtBytes(bytes);
  const exact = bytes.toLocaleString() + " B";
  return rounded === exact ? exact : `${rounded} (${exact})`;
}

function rectLabel(rect: AtomRect): string {
  return rect.box !== null ? rect.box.type : boxCount(rect.count);
}

function rectDetail(rect: AtomRect, zoomable = true): string {
  if (rect.box !== null) {
    const role = BOX_ROLES[rect.box.type];
    const size = fmtSize(rect.box.size);
    return `${rect.box.type}${role ? " — " + role : ""} · offset ${rect.box.start.toLocaleString()} · ${size}`;
  }
  return (
    `${boxCount(rect.count)} in ${fmtSize(rect.byteEnd - rect.byteStart)} at offset ` +
    `${rect.byteStart.toLocaleString()}, too many to draw one by one` +
    (zoomable ? " · click to zoom in on them" : "")
  );
}

/**
 * Whether zooming to this block would show anything the view does not already. A zoomed-in view
 * still draws the ancestors of what was zoomed to — that is the context the map is read in — and
 * each of them spans the whole of it, so clicking one used to push a crumb for a view identical to
 * the one already on screen (or, for an ancestor whose own range is wider, quietly zoom back out).
 * Either way the breadcrumb grew without the map changing, which is how a file with one video track
 * came to offer an endless path of `trak`s.
 */
function narrowsView(rect: AtomRect, view: AxisRange): boolean {
  // A hair of slack: the ranges are sums of fractions, so an edge that should land exactly on the
  // view's own can miss it by an ulp or two.
  const slack = (view.end - view.start) * 1e-9;
  return rect.from > view.start + slack || rect.to < view.end - slack;
}

function blockEl(
  rect: AtomRect,
  view: AxisRange,
  zoom: { label: string; range: AxisRange }[],
  redraw: () => void,
  readout: HTMLElement,
): HTMLButtonElement {
  const label = rectLabel(rect);
  const zoomable = narrowsView(rect, view);
  const detail = rectDetail(rect, zoomable);
  const el = h(
    "button",
    `atom-block ${familyClass(rect.family)}${rect.kind === "group" ? " grouped" : ""}${zoomable ? "" : " filling"}`,
  );
  el.type = "button";
  positionBlock(el, rect, label);

  const show = (): void => {
    readout.textContent = detail;
  };
  const clear = (): void => {
    readout.textContent = ATOM_MAP_READOUT_HINT;
  };
  el.addEventListener("mouseenter", show);
  el.addEventListener("focus", show);
  el.addEventListener("mouseleave", clear);
  el.addEventListener("blur", clear);
  // Still hoverable and focusable when it fills the view — its offset and size are worth reading —
  // but not a way further in, since there is no further in to go.
  if (zoomable) {
    el.addEventListener("click", () => {
      zoom.push({ label, range: { start: rect.from, end: rect.to } });
      redraw();
    });
  }
  return el;
}

/**
 * The key to what is drawn, and only that: a progressive file has no `moof` to explain and, at forty
 * or so boxes, nothing narrow enough to collapse into a group either — rows for both would be
 * describing marks that are not on the map. Read off the rects, so it also follows a zoom into one
 * family's subtree.
 */
function renderLegend(rects: AtomRect[]): HTMLDivElement {
  const legend = h("div", "atom-legend");
  const item = (cls: string, name: string, desc: string): HTMLSpanElement => {
    const wrap = h("span", "legend-item");
    wrap.append(h("span", "swatch " + cls), h("span", "legend-label", name), h("span", "legend-desc", desc));
    return wrap;
  };
  const drawn = new Set(rects.map((rect) => familyClass(rect.family)));
  FAMILIES.filter(([key]) => drawn.has("f-" + key)).forEach(([key, desc]) =>
    legend.append(item("f-" + key, key, desc)),
  );
  if (drawn.has("f-other")) legend.append(item("f-other", "other", "brand, padding, user data"));
  if (rects.some((rect) => rect.kind === "group")) {
    legend.append(item("f-other grouped", "N boxes", "too many to draw, in the color of most of them"));
  }
  return legend;
}

// Labels fit or they don't, and that depends on the panel's real width — which is zero while the
// tab is hidden. Observing the map covers both the first reveal and later window resizes.
function bindLabelSizing(map: HTMLElement): void {
  const sizeLabels = (): void => {
    const width = map.clientWidth;
    map.querySelectorAll<HTMLElement>(".atom-block").forEach((el) => {
      const fit = labelFit(Number(el.dataset.frac), Number(el.dataset.chars), width);
      el.classList.toggle("wide", fit === "wide");
      el.classList.toggle("snug", fit === "snug");
    });
  };
  sizeLabels();
  labelObserver?.disconnect();
  if (typeof ResizeObserver === "undefined") return;
  labelObserver = new ResizeObserver(sizeLabels);
  labelObserver.observe(map);
}
