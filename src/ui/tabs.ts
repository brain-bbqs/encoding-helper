// Tab switching, kept in sync with the `tab` query parameter so any panel can be linked to.

import { DEFAULT_TAB, isTabId, readTabFromUrl, writeTabToUrl, type TabId } from "../lib/appUrl";

export function initTabs(onShowReport: () => void): void {
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>(".tab"));

  const show = (tab: TabId): void => {
    buttons.forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
    document.querySelectorAll<HTMLElement>(".tab-panel").forEach((p) => p.classList.remove("on"));
    document.getElementById("panel-" + tab)?.classList.add("on");
    // Rebuilt on every visit (not just at load) since it reflects whatever the seeking test /
    // Compare Quality tabs have produced since the file was loaded.
    if (tab === "report") onShowReport();
  };

  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab;
      if (!isTabId(tab)) return;
      writeTabToUrl(tab, true);
      show(tab);
    });
  });

  // Back/forward then walks the tabs the user visited, which is what a per-tab URL implies.
  window.addEventListener("popstate", () => show(readTabFromUrl() ?? DEFAULT_TAB));

  const initial = readTabFromUrl();
  if (initial) show(initial);
}
