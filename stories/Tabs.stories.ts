import { withCard } from "./utils";

const TAB_LABELS: Record<string, string> = {
  inspect: "Inspect",
  atoms: "Atom Map",
  seek: "GOP & Seeking",
  encode: "Reencode & CLI",
  compare: "Compare Quality",
  reencode: "Reencode In-Browser",
};

// Kept in sync with the markup in index.html; the icon is what marks the button as the one control
// on the bar that produces a document rather than switching the view.
const ACTION_ICON = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
  stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
  <polyline points="14 2 14 8 20 8" />
  <line x1="12" y1="11" x2="12" y2="17" />
  <polyline points="9.5 14.5 12 17 14.5 14.5" />
</svg>`;

function buildTabBar(active: string): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "tab-bar";
  const tabs = Object.entries(TAB_LABELS)
    .map(([tab, label]) => `<button class="tab${tab === active ? " on" : ""}" type="button">${label}</button>`)
    .join("");
  wrap.innerHTML =
    `<div class="tabs">${tabs}</div>` +
    `<button class="tab-action${active === "analysis" ? " on" : ""}" type="button">` +
    `${ACTION_ICON}Full Analysis</button>`;
  return withCard(wrap);
}

export default {
  title: "Components/Tabs",
};

export const InspectActive = {
  name: "Inspect tab active",
  render: () => buildTabBar("inspect"),
};

export const FullAnalysisActive = {
  name: "Full Analysis active",
  render: () => buildTabBar("analysis"),
};
