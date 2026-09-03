// Small DOM-building helpers shared across every tab renderer.

import { isEducationalEnabled } from "./educational";

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string | null,
  text?: string | number | null,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = String(text);
  return e;
}

/** A <button type="button">, which every button in the app is, since none sits in a form. */
export function button(cls?: string | null, text?: string | number | null): HTMLButtonElement {
  const b = h("button", cls, text);
  b.type = "button";
  return b;
}

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

/** Closes every open info popover. Exported for the document-level dismiss handlers below. */
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
 * The "i" inside the ⓘ button, drawn rather than typed. A letter sits where its font puts it — an
 * italic serif "i" leans right of its advance box and hangs its dot high — so the glyph rode
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
  // The ⓘ affordance is teaching material like the "teach" boxes below, so it goes with the same
  // toggle: an empty, hidden span rather than `null`, since every call site treats infoIcon's
  // return as always present (gridItem appends it unconditionally once it decides to call this).
  if (!isEducationalEnabled()) return h("span", "info edu-off");
  bindInfoDismiss();
  const wrap = h("span", "info");
  const btn = button("info-btn");
  btn.append(infoGlyph());
  btn.setAttribute("aria-label", label);
  btn.setAttribute("aria-expanded", "false");
  const pop = h("div", "info-pop");
  pop.setAttribute("role", "tooltip");
  pop.innerHTML = html;
  // Decided just before the popover becomes visible, so an icon low on the page opens upward and
  // one in the last grid column opens leftward instead of off the edge.
  const place = (): void => {
    const box = btn.getBoundingClientRect();
    wrap.classList.toggle("above", box.bottom > window.innerHeight * 0.55);
    wrap.classList.toggle("flip-x", box.left + 360 > window.innerWidth);
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
 * it. `note` is the aside the bar carries while it is shut, so a closed fold still says what is in
 * there.
 */
export function fold(label: string, note?: string): { wrap: HTMLDetailsElement; body: HTMLDivElement } {
  const wrap = h("details", "fold");
  const summary = h("summary", "fold-summary");
  summary.append(h("span", null, label), h("span", "fold-note", note ?? ""));
  const body = h("div", "fold-body");
  wrap.append(summary, body);
  return { wrap, body };
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

const SVG_NS = "http://www.w3.org/2000/svg";

export function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs?: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  }
  return el;
}

/** An SVG <text> node with its class, the rest of its attributes and its content in one call. */
export function svgText(cls: string, attrs: Record<string, string | number>, content: string): SVGTextElement {
  const el = svgEl("text", { class: cls, ...attrs });
  el.textContent = content;
  return el;
}

/**
 * The circular-arrow "start again" mark, as an inline SVG.
 *
 * Drawn rather than written as 🔄, matching brain-bbqs/bbqs-uploader's re-check button: Windows
 * gives the emoji colour presentation, while a stroked path stays monochrome and follows the theme
 * through currentColor.
 */
export function resetIcon(size = 14): SVGSVGElement {
  const svg = svgEl("svg", {
    viewBox: "0 0 24 24",
    width: size,
    height: size,
    fill: "none",
    stroke: "currentColor",
    "stroke-width": 2.5,
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
  });
  svg.append(svgEl("polyline", { points: "23 4 23 10 17 10" }));
  svg.append(svgEl("path", { d: "M20.49 15 A9 9 0 1 1 18.36 5.64 L23 10" }));
  return svg;
}

/** Escapes text read out of a media file so it can be embedded in author-authored explainer markup. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * A left-accented "teach" callout box. `html` is trusted, author-authored explainer markup.
 * Rendered empty and hidden (rather than returning `null`) when the educational toggle is off, so
 * every call site can keep appending its result unconditionally.
 *
 * `mark` is the emoji in the gutter: 💡 by default, the same one the Educational switch and the
 * "Learn more about codec parameters" goal carry, so an unmarked box still reads as tied back to
 * the control that hides it. A box about one particular thing says so instead — 🎥 for what this
 * file's container is, 🎨 for chroma subsampling — which gives a card of stacked boxes something
 * to tell them apart by at a glance.
 */
export function teachBox(html: string, mark = "💡"): HTMLDivElement {
  const d = h("div", "teach");
  if (!isEducationalEnabled()) {
    d.classList.add("edu-off");
    return d;
  }
  const icon = h("span", "teach-icon", mark);
  icon.setAttribute("aria-hidden", "true");
  const body = h("div", "teach-body");
  body.innerHTML = html;
  d.append(icon, body);
  return d;
}

/** Writes to the clipboard, falling back to a hidden textarea where the API is refused. */
function writeClipboard(text: string, done: () => void): void {
  navigator.clipboard
    .writeText(text)
    .then(done)
    .catch(() => {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      done();
    });
}

export function copyToClipboard(text: string, btn: HTMLButtonElement): void {
  writeClipboard(text, () => {
    const orig = btn.textContent;
    btn.textContent = "Copied!";
    setTimeout(() => {
      btn.textContent = orig;
    }, 1400);
  });
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
