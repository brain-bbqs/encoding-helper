// Small reusable form-field / engine-progress-box builders shared by the Re-encode and Compare Quality
// tabs.

import { h } from "../lib/dom";

export function fieldSelect(
  id: string,
  label: string,
  options: (string | [string, string])[],
  value: string,
): HTMLDivElement {
  const f = h("div", "field");
  f.append(h("label", "field-label", label));
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
): HTMLDivElement {
  const f = h("div", "field");
  f.append(h("label", "field-label", label));
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
  el.append(h("div", "teach", desc));
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
  const log = h("div", "log-console");
  log.style.display = "none";
  el.append(log);
  const result = h("div");
  result.style.marginTop = "8px";
  el.append(result);
  return { el, button, progress, note, log, result };
}

export function logLine(
  container: HTMLDivElement,
  msg: string,
  level: "info" | "success" | "warn" | "error" = "info",
): void {
  container.style.display = "block";
  const line = h("div", "l " + level, msg);
  container.append(line);
  container.scrollTop = container.scrollHeight;
  while (container.children.length > 200) {
    const first = container.firstChild;
    if (first) container.removeChild(first);
  }
}
