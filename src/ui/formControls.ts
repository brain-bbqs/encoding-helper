// Small reusable form-field / engine-progress-box builders shared by the tabs that run an encode.

import { button, h } from "@brain-bbqs/ui";
import { infoIcon } from "../lib/dom";

/**
 * A field's label, with an ⓘ explainer beside it when there is one. Same shape as the grid cards'
 * `item-head`, so a control and a figure explain themselves the same way.
 *
 * `controlId` ties the label to the one control it names: the control sits beside the label rather
 * than inside it, so without the id it has no accessible name and a click on the label does not
 * reach it. A heading over a group of controls (the matrix axes' checkboxes) has no one control to
 * name and leaves it out.
 */
export function fieldHead(label: string, info?: string | null, controlId?: string): HTMLElement {
  const labelEl = h("label", "field-label", label);
  if (controlId) labelEl.htmlFor = controlId;
  if (!info) return labelEl;
  const head = h("div", "field-head");
  head.append(labelEl, infoIcon(info, `About ${label}`));
  return head;
}

/** A labelled dropdown in a field of its own, the select handed back for the caller to listen to. */
export function fieldSelect(
  id: string,
  label: string,
  options: (string | [string, string])[],
  value: string,
  /** Trusted, author-authored explainer markup, shown from an ⓘ next to the label. */
  info?: string | null,
): { field: HTMLDivElement; select: HTMLSelectElement } {
  const field = h("div", "field");
  field.append(fieldHead(label, info, id));
  const select = h("select");
  select.id = id;
  options.forEach((opt) => {
    const [v, text] = Array.isArray(opt) ? opt : [opt, opt];
    const o = h("option", null, text);
    o.value = v;
    if (v === value) o.selected = true;
    select.append(o);
  });
  field.append(select);
  return { field, select };
}

/** A labelled number box in a field of its own, the input handed back for the caller to listen to. */
export function fieldNumber(
  id: string,
  label: string,
  value: string | number,
  min: number,
  max: number,
  step: number,
): { field: HTMLDivElement; input: HTMLInputElement } {
  const field = h("div", "field");
  field.append(fieldHead(label, null, id));
  const input = h("input");
  input.type = "number";
  input.id = id;
  input.value = String(value);
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  field.append(input);
  return { field, input };
}

export interface EngineBox {
  el: HTMLDivElement;
  button: HTMLButtonElement;
  progress: HTMLDivElement;
  /** The bar's fill, which the encode advances. */
  fill: HTMLDivElement;
  note: HTMLDivElement;
  log: HTMLDivElement;
  result: HTMLDivElement;
}

/**
 * The controls of a long-running encode: the button that starts it, the bar, the line under it, its
 * console, and the block its result lands in. The heading above it belongs to the section using it.
 */
export function engineBox(buttonLabel: string): EngineBox {
  const el = h("div");
  el.style.marginBottom = "18px";
  const btn = button("btn", buttonLabel);
  btn.style.marginTop = "8px";
  el.append(btn);
  const { wrap: progress, fill } = progressBar();
  el.append(progress);
  const note = h("div", "progress-label");
  note.style.marginTop = "4px";
  el.append(note);
  const { wrap: logWrap, log } = logConsole();
  el.append(logWrap);
  const result = h("div");
  result.style.marginTop = "8px";
  el.append(result);
  return { el, button: btn, progress, fill, note, log, result };
}

/** A hidden progress bar and its fill, for the run that will show and advance it. */
export function progressBar(): { wrap: HTMLDivElement; fill: HTMLDivElement } {
  const wrap = h("div", "progress-wrap");
  wrap.style.display = "none";
  const fill = h("div", "fill");
  wrap.append(fill);
  return { wrap, fill };
}

/** Shows a bar with its fill back at the start, for the run to advance. */
export function resetProgressFill(progress: HTMLDivElement, fill: HTMLDivElement): void {
  progress.style.display = "block";
  fill.style.width = "0%";
  fill.classList.remove("done");
}

/** Fills a bar to the end, in the colour the app uses for a good outcome. */
export function finishFill(fill: HTMLDivElement): void {
  fill.style.width = "100%";
  fill.classList.add("done");
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
  if (!wrap) return;
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
  if (wrap) wrap.style.display = "";
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
