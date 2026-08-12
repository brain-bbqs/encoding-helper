// Tab: Atom Map — the MP4 box tree laid on its side.
//
// Left to right across the file, each row down one level of nesting, so the map stays the same
// handful of lanes tall whether the video runs ten seconds or ten hours. Siblings split their
// parent's width by how many boxes each subtree holds, so every box gets room and nothing in the
// file goes unshown; see atomLayout.ts for why that particular split. Every block is a button
// carrying its own offset and size, so the numbers are reachable by keyboard and screen reader as
// well as by hovering, and the Full Analysis document still writes the whole tree out as indented
// text.

import { layoutAtoms, placeAtoms, placementRange, type AtomRect, type AxisRange } from "../lib/atomLayout";
import { h, teachBox } from "../lib/dom";
import { ATOM_MAP_TEACH, ATOM_STRUCTURE_TEACH } from "../lib/explainers";
import { fmtBytes } from "../lib/format";
import { state } from "../lib/state";

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

const READOUT_HINT = "Hover a block for its offset and size; click one to zoom into it.";

/**
 * Roughly what a label costs in the two sizes the blocks draw it at: per character, plus the
 * block's own padding. Measured against the map's real width, so a box still gets named in the
 * narrow slot a file with a big moov can afford it.
 */
const LABEL_COST = {
  wide: { perChar: 6.7, padding: 10 },
  snug: { perChar: 5.8, padding: 4 },
};

// One observer at a time: each redraw builds a fresh map element and re-points the observer at it.
let labelObserver: ResizeObserver | null = null;

function familyClass(family: string | null): string {
  return family !== null && FAMILIES.some(([key]) => key === family) ? "f-" + family : "f-other";
}

export function renderAtomMap(panel: HTMLElement): void {
  panel.innerHTML = "";

  const sec = h("div", "section");
  sec.append(h("h2", null, "MP4 Box / Atom Structure"));
  sec.append(teachBox(ATOM_STRUCTURE_TEACH + `<p>${ATOM_MAP_TEACH}</p>`));

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
  panel.append(sec);
  draw();
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

function rectDetail(rect: AtomRect): string {
  if (rect.box !== null) {
    const role = BOX_ROLES[rect.box.type];
    const size = fmtSize(rect.box.size);
    return `${rect.box.type}${role ? " — " + role : ""} · offset ${rect.box.start.toLocaleString()} · ${size}`;
  }
  return (
    `${boxCount(rect.count)} in ${fmtSize(rect.byteEnd - rect.byteStart)} at offset ` +
    `${rect.byteStart.toLocaleString()}, too many to draw one by one · click to zoom in on them`
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
  legend.append(item("f-other grouped", "N boxes", "too many to draw, in the color of most of them"));
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
