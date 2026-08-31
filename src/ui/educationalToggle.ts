// The Educational switch: one control for the whole app, mounted once into the header beside the
// light/dark toggle (see main.ts) rather than into whichever card comes first. It reads the flag in
// lib/educational when it is built and writes it on change; since it lives outside the panels that
// a change rebuilds, it never needs to stay subscribed to later changes itself.

import { h } from "../lib/dom";
import { isEducationalEnabled, setEducationalEnabled } from "../lib/educational";

export function renderEducationalToggle(): HTMLLabelElement {
  const label = h("label", "edu-toggle");
  label.title = "Show explanations and ⓘ tooltips";
  const icon = h("span", "edu-toggle-icon", "🎓");
  icon.setAttribute("aria-hidden", "true");
  const input = h("input", "switch");
  input.type = "checkbox";
  // Its own name, since the word beside it is dropped on a narrow header.
  input.setAttribute("aria-label", "Educational");
  input.checked = isEducationalEnabled();
  input.addEventListener("change", () => setEducationalEnabled(input.checked));
  label.append(icon, h("span", "edu-toggle-label", "Educational"), input);
  return label;
}
