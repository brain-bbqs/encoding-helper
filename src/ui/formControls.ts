// Small reusable form-field / engine-progress-box builders shared by the tabs that run an encode.

import { h, infoIcon, teachBox } from "../lib/dom";

/**
 * A field's label, with an ⓘ explainer beside it when there is one. Same shape as the grid cards'
 * `item-head`, so a control and a figure explain themselves the same way.
 */
function fieldHead(label: string, info?: string | null): HTMLElement {
  const labelEl = h("label", "field-label", label);
  if (!info) return labelEl;
  const head = h("div", "field-head");
  head.append(labelEl, infoIcon(info, `About ${label}`));
  return head;
}

export function fieldSelect(
  id: string,
  label: string,
  options: (string | [string, string])[],
  value: string,
  /** Trusted, author-authored explainer markup, shown from an ⓘ next to the label. */
  info?: string | null,
): HTMLDivElement {
  const f = h("div", "field");
  f.append(fieldHead(label, info));
  const sel = h("select");
  sel.id = id;
  options.forEach((opt) => {
    const [v, text] = Array.isArray(opt) ? opt : [opt, opt];
    const o = h("option", null, text);
    o.value = v;
    if (v === value) o.selected = true;
    sel.append(o);
  });
  f.append(sel);
  return f;
}

export function fieldNumber(
  id: string,
  label: string,
  value: string | number,
  min: number,
  max: number,
  step: number,
  /** Trusted, author-authored explainer markup, shown from an ⓘ next to the label, as fieldSelect does. */
  info?: string | null,
): HTMLDivElement {
  const f = h("div", "field");
  f.append(fieldHead(label, info));
  const inp = h("input");
  inp.type = "number";
  inp.id = id;
  inp.value = String(value);
  inp.min = String(min);
  inp.max = String(max);
  inp.step = String(step);
  f.append(inp);
  return f;
}

export interface EngineBox {
  el: HTMLDivElement;
  button: HTMLButtonElement;
  progress: HTMLDivElement;
  note: HTMLDivElement;
  log: HTMLDivElement;
  result: HTMLDivElement;
}

export function engineBox(kind: "fast" | "exact", title: string, desc: string): EngineBox {
  const el = h("div");
  el.style.marginBottom = "18px";
  el.append(h("h3", null, title));
  // `desc` is author-authored explainer markup (entities, <b>, <code>), so it goes through
  // teachBox's innerHTML rather than being set as text.
  el.append(teachBox(desc));
  const button = h("button", "btn", kind === "fast" ? "Encode (fast)" : "Encode (exact)");
  button.type = "button";
  button.style.marginTop = "8px";
  el.append(button);
  const progress = h("div", "progress-wrap");
  progress.style.display = "none";
  progress.append(h("div", "fill"));
  el.append(progress);
  const note = h("div", "progress-label");
  note.style.marginTop = "4px";
  el.append(note);
  const console_ = logConsole();
  el.append(console_.wrap);
  const log = console_.log;
  const result = h("div");
  result.style.marginTop = "8px";
  el.append(result);
  return { el, button, progress, note, log, result };
}

/**
 * The output console and the fold it lives in, hidden until something is logged into it.
 *
 * Collapsed to begin with: it is a transcript to consult when a run looks wrong, not something to
 * read while it scrolls, and open by default it pushed the result of the run that produced it off
 * the screen. The summary carries the line count, so a closed fold still says whether there is
 * anything in there. <details> for the same reasons the matrix settings use one: it opens on click,
 * on Enter, and for a page search that hits text inside it.
 */
export function logConsole(): { wrap: HTMLDetailsElement; log: HTMLDivElement } {
  const wrap = h("details", "log-details");
  wrap.style.display = "none";
  const summary = h("summary", "log-summary");
  summary.append(h("span", null, "Output console"), h("span", "log-count"));
  const log = h("div", "log-console");
  wrap.append(summary, log);
  return { wrap, log };
}

/** Empties a console and puts its fold back out of sight, for the start of a fresh run. */
export function clearLog(container: HTMLDivElement): void {
  container.innerHTML = "";
  const wrap = container.closest<HTMLElement>(".log-details");
  if (!wrap) {
    container.style.display = "none";
    return;
  }
  wrap.style.display = "none";
  const count = wrap.querySelector(".log-count");
  if (count) count.textContent = "";
}

export function logLine(
  container: HTMLDivElement,
  msg: string,
  level: "info" | "success" | "warn" | "error" = "info",
): void {
  const wrap = container.closest<HTMLElement>(".log-details");
  // A console outside a fold shows itself, as it did before there was one to hide behind.
  if (wrap) wrap.style.display = "";
  else container.style.display = "block";
  const line = h("div", "l " + level, msg);
  container.append(line);
  container.scrollTop = container.scrollHeight;
  while (container.children.length > 200) {
    const first = container.firstChild;
    if (first) container.removeChild(first);
  }
  const count = wrap?.querySelector(".log-count");
  if (count) count.textContent = `${container.children.length} line${container.children.length === 1 ? "" : "s"}`;
}
