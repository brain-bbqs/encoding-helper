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

export interface GridItemOptions {
  wide?: boolean;
  sm?: boolean;
  /** Trusted, author-authored explainer markup, shown from an ⓘ button next to the label. */
  info?: string | null;
  /** Keeps the label's own casing instead of the grid's uppercase styling (for raw tag names). */
  rawLabel?: boolean;
}

export function gridItem(label: string, value: string | number, opts: GridItemOptions = {}): HTMLDivElement {
  const d = h("div", "item" + (opts.wide ? " wide" : ""));
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
  const btn = h("button", "info-btn", "i");
  btn.type = "button";
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
 * A left-accented "teach" callout box, marked with the same 💡 the Educational switch and the
 * "Learn more about codec parameters" goal carry, so every explainer reads as tied back to the one
 * control that hides it. `html` is trusted, author-authored explainer markup. Rendered empty and
 * hidden (rather than returning `null`) when the educational toggle is off, so every call site can
 * keep appending its result unconditionally.
 */
export function teachBox(html: string): HTMLDivElement {
  const d = h("div", "teach");
  if (!isEducationalEnabled()) {
    d.classList.add("edu-off");
    return d;
  }
  const icon = h("span", "teach-icon", "💡");
  icon.setAttribute("aria-hidden", "true");
  const body = h("div", "teach-body");
  body.innerHTML = html;
  d.append(icon, body);
  return d;
}

export function copyToClipboard(text: string, btn?: HTMLButtonElement | null): void {
  const done = (): void => {
    if (btn) {
      const orig = btn.textContent;
      btn.textContent = "Copied!";
      setTimeout(() => {
        btn.textContent = orig;
      }, 1400);
    }
  };
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
