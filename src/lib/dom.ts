// Small DOM-building helpers shared across every tab renderer.

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
}

export function gridItem(label: string, value: string | number, opts: GridItemOptions = {}): HTMLDivElement {
  const d = h("div", "item" + (opts.wide ? " wide" : ""));
  d.append(h("label", null, label), h("div", opts.sm ? "val sm" : "val", String(value)));
  return d;
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

/** A left-accented "teach" callout box. `html` is trusted, author-authored explainer markup. */
export function teachBox(html: string): HTMLDivElement {
  const d = h("div", "teach");
  d.innerHTML = html;
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
