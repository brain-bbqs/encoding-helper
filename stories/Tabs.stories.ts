import indexHtml from "../index.html?raw";
import { withCard } from "./utils";

// The tab bar is taken out of index.html itself rather than written out again here, so the story
// draws the markup the app ships. Only the lit button is set, the way src/ui/tabs.ts lights it.
function buildTabBar(active: string): HTMLElement {
  const page = new DOMParser().parseFromString(indexHtml, "text/html");
  const bar = document.importNode(page.querySelector<HTMLElement>(".tab-bar")!, true);
  for (const button of bar.querySelectorAll<HTMLElement>("[data-tab]")) {
    button.classList.toggle("on", button.dataset.tab === active);
  }
  return withCard(bar);
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
