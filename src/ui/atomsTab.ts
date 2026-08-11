// Tab: Atom Map — the MP4 box/atom tree with byte offsets and sizes, in three views.
//
// Two of them are horizontal, laying the tree along an axis with one lane per nesting depth, so the
// map is the same handful of lanes tall whether the video runs ten seconds or ten hours. "Structure"
// is the default and gives every atom room, so nothing in the file goes unshown; "Bytes" measures
// the axis in file bytes instead, which is what makes a 99%-mdat file or a moov-before-mdat
// faststart layout visible at a glance, at the cost of leaving sub-1% subtrees to be zoomed into.
// "Tree" is the original indented list, which reads every atom's numbers exactly and is the view
// that stays usable with a screen reader. The choice is remembered.

import { h, teachBox } from "../lib/dom";
import {
  layoutAtoms,
  placeAtoms,
  placementRange,
  type AtomRect,
  type AtomScale,
  type AxisRange,
  type Placement,
} from "../lib/atomLayout";
import { fmtBytes } from "../lib/format";
import { state } from "../lib/state";
import type { BoxNode } from "../lib/types";

export type AtomView = "structure" | "bytes" | "tree";

const VIEW_KEY = "encoding-helper.atomMapView";

const VIEW_LABELS: [AtomView, string][] = [
  ["structure", "Structure"],
  ["bytes", "Bytes"],
  ["tree", "Tree"],
];

/** What the atoms worth calling out actually hold, shown as a chip in the tree and in the readout. */
const BOX_ROLES: Record<string, string | undefined> = {
  ftyp: "brand",
  moov: "index",
  mdat: "sample data",
  moof: "fragment index",
  mfra: "fragment random access",
  free: "padding",
  skip: "padding",
};

/** The three atom families the horizontal views color; everything else shares the neutral slot. */
const FAMILIES: [string, string][] = [
  ["moov", "index & metadata"],
  ["mdat", "sample data"],
  ["moof", "fragment index"],
];

const READOUT_HINT = "Hover a block for its offset and size; click one to zoom into it.";

/**
 * Roughly what a label costs in the two sizes the blocks draw it at: per character, plus the
 * block's own padding. Measured against the map's real width, so `mdat` still gets named in a
 * 32px block — which is all the structure view can give it in a file whose moov holds 25 boxes.
 */
const LABEL_COST = {
  wide: { perChar: 6.7, padding: 10 },
  snug: { perChar: 5.8, padding: 4 },
};

// One observer at a time: each redraw builds a fresh map element and re-points the observer at it.
let labelObserver: ResizeObserver | null = null;

function isAtomView(value: string | null): value is AtomView {
  return VIEW_LABELS.some(([view]) => view === value);
}

function readView(): AtomView {
  try {
    const stored = localStorage.getItem(VIEW_KEY);
    return isAtomView(stored) ? stored : "structure";
  } catch {
    return "structure";
  }
}

function writeView(view: AtomView): void {
  try {
    localStorage.setItem(VIEW_KEY, view);
  } catch (e) {
    console.warn("Could not save Atom Map view preference:", e);
  }
}

function familyClass(family: string | null): string {
  return family !== null && FAMILIES.some(([key]) => key === family) ? "f-" + family : "f-other";
}

/** `initialView` overrides the remembered preference; the app itself never passes it. */
export function renderAtomMap(panel: HTMLElement, initialView?: AtomView): void {
  panel.innerHTML = "";

  const sec = h("div", "section");
  sec.append(h("h2", null, "MP4 Box / Atom Structure"));
  sec.append(
    teachBox(
      `An MP4 file is a tree of <b>boxes</b> (also called &ldquo;atoms&rdquo;): <code>ftyp</code> declares the ` +
        `brand/compatibility, <code>moov</code> holds all metadata &amp; the sample index (offsets, sizes, ` +
        `timestamps, keyframe flags), and <code>mdat</code> holds the raw encoded frame bytes it points to. ` +
        `Fragmented MP4s repeat <code>moof</code>+<code>mdat</code> pairs instead of one big <code>mdat</code>.` +
        `<p>The two horizontal views run left to right with each row down one level of nesting, so they stay ` +
        `the same height however long the video is. They differ in what across means:</p>` +
        `<ul>` +
        `<li><b>Structure</b> gives every box room — siblings split their parent's width by how many boxes ` +
        `each subtree holds — so the whole file is on screen at once. It says nothing about size.</li>` +
        `<li><b>Bytes</b> measures the file itself, so a box is as wide as the bytes it occupies. This is ` +
        `where you see that a well-encoded file is nearly all <code>mdat</code>, and whether <code>moov</code> ` +
        `comes before it (&ldquo;faststart&rdquo;). Anything under a fraction of a percent of the file has no ` +
        `room to open up, and is summarised until you zoom in.</li>` +
        `<li><b>Tree</b> is the same boxes indented, one row per box, with every number spelled out.</li>` +
        `</ul>`,
    ),
  );

  let view = initialView ?? readView();
  // Placements depend only on the file and the axis, so they outlive a redraw; zooming re-lays the
  // same placements against a narrower range.
  const placed = new Map<AtomScale, Placement[]>();
  const placementsFor = (scale: AtomScale): Placement[] => {
    const cached = placed.get(scale);
    if (cached) return cached;
    const fresh = placeAtoms(state.boxes, scale);
    placed.set(scale, fresh);
    return fresh;
  };
  // Zoom path, in the coordinates of whichever axis is showing; switching axis discards it.
  let zoom: { label: string; range: AxisRange }[] = [];

  const controls = h("div", "seg");
  controls.setAttribute("role", "group");
  controls.setAttribute("aria-label", "Atom Map view");
  const buttons = new Map<AtomView, HTMLButtonElement>();
  const body = h("div");

  const draw = (): void => {
    buttons.forEach((btn, key) => {
      btn.classList.toggle("on", key === view);
      btn.setAttribute("aria-pressed", String(key === view));
    });
    body.innerHTML = "";
    if (state.boxes.length === 0) {
      body.append(h("div", "progress-label", "No boxes were parsed for this file."));
      return;
    }
    if (view === "tree") renderTree(body);
    else renderMap(body, view, placementsFor(view), zoom, draw);
  };

  VIEW_LABELS.forEach(([key, label]) => {
    const btn = h("button", "seg-btn", label);
    btn.type = "button";
    btn.addEventListener("click", () => {
      // The zoom path is a set of ranges on one axis, and means nothing on the other.
      if (key !== view && key !== "tree" && view !== "tree") zoom = [];
      view = key;
      writeView(key);
      draw();
    });
    buttons.set(key, btn);
    controls.append(btn);
  });

  sec.append(controls, body);
  panel.append(sec);
  draw();
}

// ------------------------------------------------------------------------------- horizontal maps

function renderMap(
  host: HTMLElement,
  scale: AtomScale,
  placements: Placement[],
  zoom: { label: string; range: AxisRange }[],
  redraw: () => void,
): void {
  const fullRange = placementRange(placements);
  const view = zoom.length > 0 ? zoom[zoom.length - 1].range : fullRange;
  const layout = layoutAtoms(placements, view);
  const shown = layout.rects.reduce((n, r) => n + r.count, 0);

  host.append(renderCrumbs(scale, view, shown, zoom, redraw));
  // Only the byte axis has a scale worth labelling; on the structure axis, position means nothing
  // beyond order.
  if (scale === "bytes") host.append(renderRuler(view));

  const map = h("div", "atom-map");
  const lanes: HTMLDivElement[] = [];
  for (let depth = 0; depth < layout.laneCount; depth++) {
    const lane = h("div", "atom-lane");
    lanes.push(lane);
    map.append(lane);
  }
  const readout = h("div", "atom-readout", READOUT_HINT);
  layout.rects.forEach((rect) => lanes[rect.depth].append(blockEl(rect, zoom, redraw, readout)));
  host.append(map, readout);

  if (layout.truncated) {
    host.append(h("div", "progress-label", "This file nests further than the map draws; zoom in to see the rest."));
  }
  host.append(renderLegend());
  bindLabelSizing(map);
}

function renderCrumbs(
  scale: AtomScale,
  view: AxisRange,
  shown: number,
  zoom: { label: string; range: AxisRange }[],
  redraw: () => void,
): HTMLDivElement {
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
  const summary =
    scale === "bytes"
      ? `bytes ${view.start.toLocaleString()}–${view.end.toLocaleString()} (${fmtBytes(view.end - view.start)})`
      : `${boxCount(shown)} shown`;
  crumbs.append(h("span", "crumb-range", summary));
  return crumbs;
}

function renderRuler(view: AxisRange): HTMLDivElement {
  const ruler = h("div", "atom-ruler");
  const STEPS = 4;
  for (let i = 0; i <= STEPS; i++) {
    const at = view.start + ((view.end - view.start) * i) / STEPS;
    const tick = h("span", "tick", fmtBytes(at));
    if (i === 0) tick.classList.add("first");
    if (i === STEPS) tick.classList.add("last");
    // Dropped on narrow screens, where five labels run into each other.
    if (i % 2 === 1) tick.classList.add("odd");
    tick.style.left = (i / STEPS) * 100 + "%";
    ruler.append(tick);
  }
  return ruler;
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

function rectDetail(rect: AtomRect): string {
  if (rect.box !== null) {
    const role = BOX_ROLES[rect.box.type];
    const size = fmtSize(rect.box.size);
    return `${rect.box.type}${role ? " — " + role : ""} · offset ${rect.box.start.toLocaleString()} · ${size}`;
  }
  return (
    `${boxCount(rect.count)} in ${fmtSize(rect.byteEnd - rect.byteStart)} at offset ` +
    `${rect.byteStart.toLocaleString()}, too little of the file to draw one by one · click to zoom in on them`
  );
}

function blockEl(
  rect: AtomRect,
  zoom: { label: string; range: AxisRange }[],
  redraw: () => void,
  readout: HTMLElement,
): HTMLButtonElement {
  const label = rectLabel(rect);
  const detail = rectDetail(rect);
  const el = h("button", `atom-block ${familyClass(rect.family)}${rect.kind === "group" ? " grouped" : ""}`);
  el.type = "button";
  el.style.left = rect.x * 100 + "%";
  el.style.width = rect.w * 100 + "%";
  el.dataset.frac = String(rect.w);
  el.dataset.chars = String(label.length);
  el.setAttribute("aria-label", detail);
  el.append(h("span", "lbl", label));

  const show = (): void => {
    readout.textContent = detail;
  };
  const clear = (): void => {
    readout.textContent = READOUT_HINT;
  };
  el.addEventListener("mouseenter", show);
  el.addEventListener("focus", show);
  el.addEventListener("mouseleave", clear);
  el.addEventListener("blur", clear);
  el.addEventListener("click", () => {
    zoom.push({ label, range: { start: rect.from, end: rect.to } });
    redraw();
  });
  return el;
}

function renderLegend(): HTMLDivElement {
  const legend = h("div", "atom-legend");
  const item = (cls: string, name: string, desc: string): HTMLSpanElement => {
    const wrap = h("span", "legend-item");
    wrap.append(h("span", "swatch " + cls), h("span", "legend-label", name), h("span", "legend-desc", desc));
    return wrap;
  };
  FAMILIES.forEach(([key, desc]) => legend.append(item("f-" + key, key, desc)));
  legend.append(item("f-other", "other", "brand, padding, user data"));
  legend.append(item("f-other grouped", "N boxes", "too narrow to draw, in the color of most of them"));
  legend.append(
    h("span", "legend-note", "A box's color is the top-level box it belongs to; each row down is one level in."),
  );
  return legend;
}

// Labels fit or they don't, and that depends on the panel's real width — which is zero while the
// tab is hidden. Observing the map covers both the first reveal and later window resizes.
function bindLabelSizing(map: HTMLElement): void {
  const sizeLabels = (): void => {
    const width = map.clientWidth;
    map.querySelectorAll<HTMLElement>(".atom-block").forEach((el) => {
      const px = Number(el.dataset.frac) * width;
      const chars = Number(el.dataset.chars);
      const wide = px >= chars * LABEL_COST.wide.perChar + LABEL_COST.wide.padding;
      el.classList.toggle("wide", wide);
      el.classList.toggle("snug", !wide && px >= chars * LABEL_COST.snug.perChar + LABEL_COST.snug.padding);
    });
  };
  sizeLabels();
  labelObserver?.disconnect();
  if (typeof ResizeObserver === "undefined") return;
  labelObserver = new ResizeObserver(sizeLabels);
  labelObserver.observe(map);
}

// ------------------------------------------------------------------------------- vertical tree

function renderNode(tree: HTMLElement, box: BoxNode, depth: number): void {
  const row = h("div", "atom-row");
  row.style.paddingLeft = depth * 18 + "px";
  row.append(h("span", "type", box.type));
  row.append(h("span", "off", "offset " + box.start.toLocaleString()));
  row.append(h("span", "sz", fmtSize(box.size)));
  const role = BOX_ROLES[box.type];
  if (role) row.append(h("span", "tag", role));
  tree.append(row);
  box.children.forEach((c) => renderNode(tree, c, depth + 1));
}

function renderTree(host: HTMLElement): void {
  const tree = h("div", "atom-tree");
  state.boxes.forEach((b) => renderNode(tree, b, 0));
  const treeScroll = h("div", "scroll-x");
  treeScroll.append(tree);
  host.append(treeScroll);
}
