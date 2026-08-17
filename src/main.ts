import "./style.css";
import { ensureMediabunny } from "./lib/mediabunny";
import { renderAnalysisTab } from "./ui/analysisTab";
import { renderAtomMap } from "./ui/atomsTab";
import { renderCompareTab } from "./ui/compareTab";
import { getElements } from "./ui/elements";
import { renderEncodeTab } from "./ui/encodeTab";
import { initFileLoadingUi } from "./ui/fileLoading";
import { renderInspect } from "./ui/inspectTab";
import { renderSeekTab } from "./ui/seekTab";
import { initTabs } from "./ui/tabs";

const els = getElements();

function renderAll(): void {
  // Inspect is what the file *is*: the metadata, the map of how it is laid out, and the structure
  // that governs how it seeks. Three renderers, one panel, in reading order — each appends, so the
  // panel is emptied here rather than three times over.
  els.panels.inspect.innerHTML = "";
  renderInspect(els.panels.inspect);
  renderAtomMap(els.panels.inspect);
  renderSeekTab(els.panels.inspect);
  renderEncodeTab(els.panels.encode);
  renderCompareTab(els.panels.compare);
  renderAnalysisTab(els.panels.analysis);
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
initTabs(() => renderAnalysisTab(els.panels.analysis));

// Preloaded (not deferred to first file drop) so the metadata read and the A/B window's decoding
// don't stall on it later — matches the original CDN version's eager `ensureMediabunny()` call.
ensureMediabunny().catch((err: unknown) => {
  console.warn("[encoding-helper] mediabunny preload failed:", err);
});
