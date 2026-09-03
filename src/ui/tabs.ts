// Panel switching, kept in sync with the `tab` query parameter so any panel can be linked to.
//
// The row of `.tab` buttons and the Full Analysis button beside it are one control between them:
// only one panel is ever shown, so every button carrying a `data-tab` takes part in the same
// toggle, whichever side of the bar it sits on.

import { DEFAULT_TAB, isTabId, readTabFromUrl, writeTabToUrl, type TabId } from "../lib/appUrl";

export function initTabs(onShowAnalysis: () => void): void {
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-tab]"));
  const panels = Array.from(document.querySelectorAll<HTMLElement>(".tab-panel"));

  const show = (tab: TabId): void => {
    buttons.forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
    panels.forEach((p) => p.classList.remove("on"));
    document.getElementById("panel-" + tab)?.classList.add("on");
    // Rebuilt on every visit (not just at load) since it gathers whatever the seeking test, Compare
    // Quality and the in-browser encoders have produced since the file was loaded.
    if (tab === "analysis") onShowAnalysis();
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
  if (initial) {
    // Written back as well as shown, so a link naming a tab that no longer exists leaves the
    // address bar naming the tab its content moved to.
    writeTabToUrl(initial, false);
    show(initial);
  }
}
