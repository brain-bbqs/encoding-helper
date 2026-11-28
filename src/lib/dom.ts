// The DOM-building helpers that are this app's own: the teaching material the Educational switch
// hides, and the card and table shapes only its tabs draw. The generic ones (h, button, svgEl, ...)
// come from @brain-bbqs/ui.

import { button, h, svgEl, writeClipboard } from "@brain-bbqs/ui";
import type { Badge, FactRow } from "./types";

/** A card with its heading, the unit every tab is built from. */
export function section(title: string): HTMLDivElement {
  const sec = h("div", "section");
  sec.append(h("h2", null, title));
  return sec;
}

interface GridItemOptions {
  sm?: boolean;
  /** Trusted, author-authored explainer markup, shown from an ⓘ button next to the label. */
  info?: string | null;
  /** Keeps the label's own casing instead of the grid's uppercase styling (for raw tag names). */
  rawLabel?: boolean;
}

export function gridItem(label: string, value: string | number, opts: GridItemOptions = {}): HTMLDivElement {
  const d = h("div", "item");
  const labelEl = h("label", opts.rawLabel ? "raw" : null, label);
  if (opts.info) {
    // The button is a sibling of the label rather than a child of it: <label> may not contain
    // labelable elements, and a click on the label would otherwise be forwarded to the button.
    const head = h("div", "item-head");
    head.append(labelEl, infoIcon(opts.info, `About ${label}`));
    d.append(head);
  } else {
    d.append(labelEl);
  }
  d.append(h("div", opts.sm ? "val sm" : "val", String(value)));
  return d;
}

/** One of a card's shared rows as a grid item, with the hints the card gave it. */
export function factItem(row: FactRow): HTMLDivElement {
  return gridItem(row.label, row.value, { sm: row.sm, info: row.info });
}

/** A card's shared rows as its grid. */
export function factGrid(rows: FactRow[]): HTMLDivElement {
  const grid = h("div", "grid");
  grid.append(...rows.map(factItem));
  return grid;
}

/** A verdict drawn as a badge, on the page and in the Full Analysis document alike. */
export function badgeEl(badge: Badge): HTMLSpanElement {
  return h("span", "badge " + badge.tone, badge.text);
}

/** Closes every open info popover, for the dismiss handlers and icons below. Exported for the tests. */
export function closeInfoPopovers(): void {
  document.querySelectorAll<HTMLElement>(".info.open").forEach((wrap) => {
    wrap.classList.remove("open");
    wrap.querySelector(".info-btn")?.setAttribute("aria-expanded", "false");
  });
}

let infoDismissBound = false;

// Hover and keyboard focus reveal the popover in CSS alone; the `open` class is what makes it
// usable on touch, where there is no hover. One document-level pair of listeners serves every
// icon on the page, however many tabs have been rendered.
function bindInfoDismiss(): void {
  if (infoDismissBound) return;
  infoDismissBound = true;
  document.addEventListener("click", () => closeInfoPopovers());
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeInfoPopovers();
  });
}

/**
 * The "i" inside the ⓘ button, drawn rather than typed. A letter sits where its font puts it (an
 * italic serif "i" leans right of its advance box and hangs its dot high), so the glyph rode
 * off-centre in the circle, differently on each platform's fallback font. Two shapes in a square
 * viewBox, with the ink spanning 2 to 8 either way, are centred wherever the icon is drawn.
 */
function infoGlyph(): SVGSVGElement {
  const svg = svgEl("svg", { viewBox: "0 0 10 10", "aria-hidden": "true", focusable: "false" });
  svg.append(
    svgEl("circle", { cx: 5, cy: 2.85, r: 0.85 }),
    svgEl("rect", { x: 4.25, y: 4.6, width: 1.5, height: 3.4, rx: 0.55 }),
  );
  return svg;
}

/**
 * A small ⓘ affordance with a popover explainer. `html` is trusted, author-authored markup; never
 * pass in text read out of a media file without escaping it first.
 */
export function infoIcon(html: string, label = "More information"): HTMLSpanElement {
  // Teaching material like the "teach" boxes below, so it carries the same `edu` mark the
  // stylesheet hides while the Educational switch is off.
  bindInfoDismiss();
  const wrap = h("span", "info edu");
  const btn = button("info-btn");
  btn.append(infoGlyph());
  btn.setAttribute("aria-label", label);
  btn.setAttribute("aria-expanded", "false");
  const pop = h("div", "info-pop");
  pop.setAttribute("role", "tooltip");
  pop.innerHTML = html;
  // Decided just before the popover becomes visible, so an icon low on the page opens upward and
  // one near the right edge opens leftward instead of off it. Sideways, the popover is laid out on
  // each side in turn and its box read back, so the choice follows the width and offsets the
  // `.info-pop` rules in src/style.css give it on any viewport and for an explainer of any length.
  // It opens rightward if it fits there, else leftward if it fits there. Where it fits on neither
  // side it opens toward the one with more room, the right on a tie, and runs past that edge by the
  // shortfall: the page scrolls sideways to reach it on the right, while on the left it is cut off.
  const place = (): void => {
    const box = btn.getBoundingClientRect();
    wrap.classList.toggle("above", box.bottom > window.innerHeight * 0.55);
    // Laid out but unseen for the reads, whether or not the stylesheet is showing it yet, then
    // handed back to the stylesheet before anything can paint.
    const inline = pop.style.cssText;
    pop.style.display = "block";
    pop.style.visibility = "hidden";
    wrap.classList.remove("flip-x");
    const right = pop.getBoundingClientRect();
    wrap.classList.add("flip-x");
    const left = pop.getBoundingClientRect();
    pop.style.cssText = inline;
    // The viewport less any vertical scrollbar, which a popover should not run under.
    const viewport = document.documentElement.clientWidth;
    const fitsRight = right.right <= viewport;
    const fitsLeft = left.left >= 0;
    const roomierLeft = left.right > viewport - right.left;
    wrap.classList.toggle("flip-x", !fitsRight && (fitsLeft || roomierLeft));
  };
  wrap.addEventListener("mouseenter", place);
  wrap.addEventListener("focusin", place);
  btn.addEventListener("click", (e) => {
    place();
    e.stopPropagation();
    const wasOpen = wrap.classList.contains("open");
    closeInfoPopovers();
    wrap.classList.toggle("open", !wasOpen);
    btn.setAttribute("aria-expanded", String(!wasOpen));
  });
  // A click inside the popover (e.g. on a link) must not bubble up to the dismiss handler.
  pop.addEventListener("click", (e) => e.stopPropagation());
  wrap.append(btn, pop);
  return wrap;
}

/**
 * A closed disclosure fold with a summary bar, for detail that belongs with a result without
 * standing between the reader and it. <details> for the same reasons the output console and the
 * sweep settings use one: it opens on click, on Enter, and for a page search hitting text inside
 * it. `note` is the empty slot on the right of the bar, for the caller to fill with whatever should
 * stay in reach while the fold is shut.
 */
export function fold(label: string): { wrap: HTMLDetailsElement; note: HTMLSpanElement; body: HTMLDivElement } {
  const wrap = h("details", "fold");
  const summary = h("summary", "fold-summary");
  const note = h("span", "fold-note");
  summary.append(h("span", null, label), note);
  const body = h("div", "fold-body");
  wrap.append(summary, body);
  return { wrap, note, body };
}

/** A table of text cells inside a horizontal scroller, as the seeking test and the document draw one. */
export function dataTable(headers: string[], rows: string[][]): HTMLDivElement {
  const scroll = h("div", "scroll-x");
  const table = h("table", "data");
  const thead = h("thead");
  const headRow = h("tr");
  headers.forEach((hd) => headRow.append(h("th", null, hd)));
  thead.append(headRow);
  const tbody = h("tbody");
  rows.forEach((row) => {
    const tr = h("tr");
    row.forEach((cell) => tr.append(h("td", null, cell)));
    tbody.append(tr);
  });
  table.append(thead, tbody);
  scroll.append(table);
  return scroll;
}

/**
 * A left-accented "teach" callout box. `html` is trusted, author-authored explainer markup.
 * Built in full whatever the Educational switch says, marked `edu` for the stylesheet to hide while
 * it is off, so a flip shows or hides it without the panel around it being drawn again.
 *
 * `mark` is the emoji in the gutter, saying what the box is about (🎥 for what this file's
 * container is, 🎨 for chroma subsampling), which gives a card of stacked boxes something to tell
 * them apart by at a glance.
 */
export function teachBox(html: string, mark: string): HTMLDivElement {
  const d = h("div", "teach edu");
  const icon = h("span", "teach-icon", mark);
  icon.setAttribute("aria-hidden", "true");
  const body = h("div", "teach-body");
  body.innerHTML = html;
  d.append(icon, body);
  return d;
}

/**
 * A command in a code block, with a copy control in its corner rather than a button under it: the
 * command is the thing on offer, and a labelled button repeated under every block is more furniture
 * than the action needs. The control is revealed on hover and by keyboard focus, and is always shown
 * where there is no pointer to hover with (see .cmd-copy in style.css).
 */
export function cmdBlock(text?: string): { wrap: HTMLDivElement; pre: HTMLPreElement } {
  const wrap = h("div", "cmd-wrap");
  const pre = h("pre", "cmd", text);
  const btn = button("cmd-copy");
  btn.setAttribute("aria-label", "Copy command");
  const icon = svgEl("svg", { viewBox: "0 0 16 16", "aria-hidden": "true", focusable: "false" });
  icon.append(
    svgEl("rect", { x: 5.5, y: 2.5, width: 8, height: 10, rx: 1.5 }),
    svgEl("path", { d: "M10.5 13.5H3.5a1 1 0 0 1-1-1V5" }),
  );
  const said = h("span", "cmd-copied", "Copied");
  btn.append(icon, said);
  btn.addEventListener("click", () => {
    writeClipboard(pre.textContent || "", () => {
      btn.classList.add("copied");
      setTimeout(() => btn.classList.remove("copied"), 1400);
    });
  });
  wrap.append(pre, btn);
  return { wrap, pre };
}
