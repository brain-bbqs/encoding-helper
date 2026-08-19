// The Educational switch, built fresh wherever it is placed rather than as one global fixture: it
// sits at the top-right of the first card on Inspect and Reencode with FFmpeg — the two tabs that
// carry teaching material worth silencing — and is left off Compare Quality, which has none since
// its own intro explainer was dropped. Every instance shares the one flag in lib/educational; a
// toggle click rebuilds every tab (see main.ts), so each instance only ever needs to read the
// current value at the moment it is built, not stay subscribed to later changes itself.

import { h } from "../lib/dom";
import { isEducationalEnabled, setEducationalEnabled } from "../lib/educational";

export function renderEducationalToggle(): HTMLLabelElement {
  const label = h("label", "edu-toggle card-toggle");
  label.title = "Enable educational explanations and ⓘ tooltips throughout the app";
  const icon = h("span", "edu-toggle-icon", "🎓");
  icon.setAttribute("aria-hidden", "true");
  const input = h("input", "switch");
  input.type = "checkbox";
  input.checked = isEducationalEnabled();
  input.addEventListener("change", () => setEducationalEnabled(input.checked));
  label.append(icon, h("span", "edu-toggle-label", "Educational"), input);
  return label;
}
