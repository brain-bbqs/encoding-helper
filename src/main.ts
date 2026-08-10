import "./style.css";
import { ensureMediabunny } from "./lib/mediabunny";
import { renderAtomMap } from "./ui/atomsTab";
import { renderEncodeTestTab } from "./ui/compareTab";
import { getElements } from "./ui/elements";
import { renderEncodeTab } from "./ui/encodeTab";
import { initFileLoadingUi } from "./ui/fileLoading";
import { renderInspect } from "./ui/inspectTab";
import { renderReencodeTab } from "./ui/reencodeTab";
import { renderReportTab } from "./ui/reportTab";
import { renderSeekTab } from "./ui/seekTab";
import { initTabs } from "./ui/tabs";

const els = getElements();

function renderAll(): void {
  renderInspect(els.panels.inspect);
  renderAtomMap(els.panels.atoms);
  renderSeekTab(els.panels.seek);
  renderEncodeTab(els.panels.encode);
  renderEncodeTestTab(els.panels.compare);
  renderReencodeTab(els.panels.reencode);
  renderReportTab(els.panels.report, els.printArea);
}

// Footer version stamp; the anchor itself already points at the source repository.
els.versionIndicator.textContent = `v${__APP_VERSION__}`;

// Light/dark theme, mirroring brain-bbqs/clip-extractor and brain-bbqs/bbqs-uploader: the toggle
// writes an explicit override to data-theme on <html> (pre-applied before first paint by the
// inline script in index.html); with nothing stored, data-theme is unset and the OS preference
// applies. Key kept in sync with that script.
const THEME_KEY = "encoding-helper.theme";
const prefersDark = window.matchMedia("(prefers-color-scheme: dark)");

els.themeToggle.addEventListener("click", () => {
  const current = document.documentElement.dataset.theme ?? (prefersDark.matches ? "dark" : "light");
  const next = current === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch (e) {
    console.warn("Could not save theme preference:", e);
  }
});

initFileLoadingUi(els, { onLoaded: renderAll });
initTabs(() => renderReportTab(els.panels.report, els.printArea));

// Preloaded (not deferred to first file drop) so the fast/exact engine checks in the Re-encode tab
// don't stall on it later — matches the original CDN version's eager `ensureMediabunny()` call.
ensureMediabunny().catch((err: unknown) => {
  console.warn("[encoding-helper] mediabunny preload failed:", err);
});
