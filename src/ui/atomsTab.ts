// Tab: Atom Map — the MP4 box/atom tree with byte offsets and sizes, in either orientation.
//
// Horizontal is the default: the file's byte axis runs left to right, one lane per nesting depth,
// so the map is the same handful of lanes tall whether the video is ten seconds or ten hours. The
// vertical indented tree is the original view, kept because it is the one that reads every atom's
// numbers exactly and stays usable with a screen reader; the toggle between them is remembered.

import { h, teachBox } from "../lib/dom";
import { layoutAtoms, treeRange, type AtomRect, type ByteRange } from "../lib/atomLayout";
import { fmtBytes } from "../lib/format";
import { state } from "../lib/state";
import type { BoxNode } from "../lib/types";

export type AtomOrientation = "horizontal" | "vertical";

const ORIENTATION_KEY = "encoding-helper.atomMapOrientation";

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

/** The three atom families the byte map colors; everything else shares the neutral "other" slot. */
const FAMILIES: [string, string][] = [
  ["moov", "index & metadata"],
  ["mdat", "sample data"],
  ["moof", "fragment index"],
];

const READOUT_HINT = "Hover a block for its offset and size; click one to zoom into its byte range.";

/** Labels only fit once a block is this wide, so they are shown per measured width, not per fraction. */
const LABEL_PX = { box: 34, group: 78 };

// One observer at a time: each redraw builds a fresh map element and re-points the observer at it.
let labelObserver: ResizeObserver | null = null;

function readOrientation(): AtomOrientation {
  try {
    return localStorage.getItem(ORIENTATION_KEY) === "vertical" ? "vertical" : "horizontal";
  } catch {
    return "horizontal";
  }
}

function writeOrientation(orientation: AtomOrientation): void {
  try {
    localStorage.setItem(ORIENTATION_KEY, orientation);
  } catch (e) {
    console.warn("Could not save Atom Map orientation preference:", e);
  }
}

function familyClass(family: string | null): string {
  return family !== null && FAMILIES.some(([key]) => key === family) ? "f-" + family : "f-other";
}

/** `initialOrientation` overrides the remembered preference; the app itself never passes it. */
export function renderAtomMap(panel: HTMLElement, initialOrientation?: AtomOrientation): void {
  panel.innerHTML = "";

  const sec = h("div", "section");
  sec.append(h("h2", null, "MP4 Box / Atom Structure"));
  sec.append(
    teachBox(
      `An MP4 file is a tree of <b>boxes</b> (also called &ldquo;atoms&rdquo;): <code>ftyp</code> declares the ` +
        `brand/compatibility, <code>moov</code> holds all metadata &amp; the sample index (offsets, sizes, ` +
        `timestamps, keyframe flags), and <code>mdat</code> holds the raw encoded frame bytes it points to. ` +
        `Fragmented MP4s repeat <code>moof</code>+<code>mdat</code> pairs instead of one big <code>mdat</code>.` +
        `<p>The <b>horizontal</b> view maps those boxes onto the file itself: left to right is byte offset, ` +
        `each row down is one level of nesting. It shows where the bytes actually go — a well-encoded file is ` +
        `nearly all <code>mdat</code> — and it stays the same height however long the video is. The ` +
        `<b>vertical</b> view is the same tree indented, one row per box, with every number spelled out.</p>`,
    ),
  );

  let orientation = initialOrientation ?? readOrientation();
  const fullRange = treeRange(state.boxes);
  // Zoom path for the byte map, kept across orientation switches so going to the tree and back
  // does not throw away where you had drilled to.
  const zoom: { label: string; range: ByteRange }[] = [];

  const toggle = h("div", "seg");
  toggle.setAttribute("role", "group");
  toggle.setAttribute("aria-label", "Atom Map orientation");
  const buttons: Record<AtomOrientation, HTMLButtonElement> = {
    horizontal: h("button", "seg-btn", "Horizontal"),
    vertical: h("button", "seg-btn", "Vertical"),
  };
  const body = h("div");

  const draw = (): void => {
    (Object.keys(buttons) as AtomOrientation[]).forEach((key) => {
      buttons[key].classList.toggle("on", key === orientation);
      buttons[key].setAttribute("aria-pressed", String(key === orientation));
    });
    body.innerHTML = "";
    if (state.boxes.length === 0) {
      body.append(h("div", "progress-label", "No boxes were parsed for this file."));
      return;
    }
    if (orientation === "horizontal") renderByteMap(body, fullRange, zoom, draw);
    else renderTree(body);
  };

  (Object.keys(buttons) as AtomOrientation[]).forEach((key) => {
    const btn = buttons[key];
    btn.type = "button";
    btn.addEventListener("click", () => {
      orientation = key;
      writeOrientation(key);
      draw();
    });
    toggle.append(btn);
  });

  sec.append(toggle, body);
  panel.append(sec);
  draw();
}

// ---------------------------------------------------------------------------- horizontal byte map

function renderByteMap(
  host: HTMLElement,
  fullRange: ByteRange,
  zoom: { label: string; range: ByteRange }[],
  redraw: () => void,
): void {
  const view = zoom.length > 0 ? zoom[zoom.length - 1].range : fullRange;
  const layout = layoutAtoms(state.boxes, view);

  host.append(renderCrumbs(view, zoom, redraw));
  host.append(renderRuler(view));

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
  view: ByteRange,
  zoom: { label: string; range: ByteRange }[],
  redraw: () => void,
): HTMLDivElement {
  const crumbs = h("div", "atom-crumbs");
  crumbs.setAttribute("aria-label", "Byte map zoom path");
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
  crumbs.append(
    h(
      "span",
      "crumb-range",
      `bytes ${view.start.toLocaleString()}–${view.end.toLocaleString()} (${fmtBytes(view.end - view.start)})`,
    ),
  );
  return crumbs;
}

function renderRuler(view: ByteRange): HTMLDivElement {
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
  const span = fmtSize(rect.end - rect.start);
  return (
    `${boxCount(rect.count)} packed into ${span} at offset ${rect.start.toLocaleString()}, too little of the ` +
    `file to draw one by one · click to zoom in on them`
  );
}

function blockEl(
  rect: AtomRect,
  zoom: { label: string; range: ByteRange }[],
  redraw: () => void,
  readout: HTMLElement,
): HTMLButtonElement {
  const label = rectLabel(rect);
  const detail = rectDetail(rect);
  const el = h("button", `atom-block ${rect.kind === "group" ? "grouped" : familyClass(rect.family)}`);
  el.type = "button";
  el.style.left = rect.x * 100 + "%";
  el.style.width = rect.w * 100 + "%";
  el.dataset.frac = String(rect.w);
  el.dataset.labelPx = String(LABEL_PX[rect.kind]);
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
    zoom.push({ label, range: { start: rect.start, end: rect.end } });
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
  legend.append(item("grouped", "N boxes", "too narrow to draw; click to zoom"));
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
      const fits = Number(el.dataset.frac) * width >= Number(el.dataset.labelPx);
      el.classList.toggle("wide", fits);
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
