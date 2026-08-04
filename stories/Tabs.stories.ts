import { withCard } from "./utils";

const TAB_LABELS: Record<string, string> = {
  inspect: "Inspect",
  atoms: "Atom Map",
  seek: "GOP & Seeking",
  encode: "Re-encode & CLI",
  compare: "Encode Test",
  report: "Report",
};

function buildTabs(active: string): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "tabs";
  wrap.innerHTML = Object.entries(TAB_LABELS)
    .map(([tab, label]) => `<button class="tab${tab === active ? " on" : ""}" type="button">${label}</button>`)
    .join("");
  return withCard(wrap);
}

export default {
  title: "Components/Tabs",
};

export const InspectActive = {
  name: "Inspect tab active",
  render: () => buildTabs("inspect"),
};

export const ReportActive = {
  name: "Report tab active",
  render: () => buildTabs("report"),
};
