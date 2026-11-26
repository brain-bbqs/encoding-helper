import "./style.css";
import changelog from "../CHANGELOG.md?raw";
import { initThemeToggle, initWhatsNew, renderVersion } from "@brain-bbqs/ui";
import { isEducationalEnabled, onEducationalChange } from "./lib/educational";
import { THEME_KEY } from "./lib/settings";
import { teachBox } from "./lib/dom";
import { APP_INTRO } from "./lib/explainers";
import { matrixCache } from "./lib/matrixCache";
import { ensureMediabunny } from "./lib/mediabunny";
import { renderAnalysisTab } from "./ui/analysisTab";
import { renderAtomMap } from "./ui/atomsTab";
import { renderCompareTab } from "./ui/compareTab";
import { renderEducationalToggle } from "./ui/educationalToggle";
import { getElements } from "./ui/elements";
import { renderEncodeTab } from "./ui/encodeTab";
import { initDemosPage } from "./ui/demosPage";
import { initFileLoadingUi } from "./ui/fileLoading";
import { mountInspectToc } from "./ui/inspectToc";
import { renderInspectHead, renderInspectTail } from "./ui/inspectTab";
import { renderGopStructure } from "./ui/seekTab";
import { initTabs } from "./ui/tabs";

const els = getElements();

function renderAll(): void {
  // Inspect is what the file *is*: the metadata, the map of how it is laid out, and the structure
  // that governs how it seeks. Reading order follows the file's own structure: overview cards, the
  // atom map, the GOP/keyframe structure the map's box order decides, then the bitrate over time,
  // with the audio track last since everything above it is about the video. Each renderer appends,
  // so the panel is emptied here rather than once per renderer.
  els.panels.inspect.innerHTML = "";
  renderInspectHead(els.panels.inspect);
  renderAtomMap(els.panels.inspect);
  renderGopStructure(els.panels.inspect);
  renderInspectTail(els.panels.inspect);
  // Wraps whatever the four renderers above just appended into a content column beside an "On this
  // page" nav built from their own section headings; must run after them, not interleaved.
  mountInspectToc(els.panels.inspect);
  renderEncodeTab(els.panels.encode);
  renderCompareTab(els.panels.compare);
  renderAnalysisTab(els.panels.analysis);
}

renderVersion(els.versionIndicator, __APP_VERSION__);
initWhatsNew(els.whatsNew, { changelog });

// Forgetting every sweep measurement kept for every file (see lib/matrixCache), beside the version
// stamp as bbqs-uploader keeps its own cache control. The label reports what happened for a moment
// rather than opening a dialog: there is nothing to lose but encoding time, and the button is the
// only place in the page that says the cache exists at all.
els.clearCacheBtn.addEventListener("click", () => {
  const label = els.clearCacheBtn.textContent;
  els.clearCacheBtn.disabled = true;
  els.clearCacheBtn.textContent = "Sweep cache cleared";
  void matrixCache.clear().finally(() => {
    window.setTimeout(() => {
      els.clearCacheBtn.disabled = false;
      els.clearCacheBtn.textContent = label;
    }, 1500);
  });
});

// Light/dark theme: the toggle writes an explicit override to data-theme on <html> (pre-applied
// before first paint by the script configs/vite.config.ts injects into index.html); with nothing
// stored, the OS preference applies.
initThemeToggle(els.themeToggle, { storageKey: THEME_KEY });

// Teaching material (the "teach" boxes and the ⓘ info-icon popovers) is on by default and
// remembered across reloads. The switch sits in the header beside the light/dark toggle: one
// preference control for the whole app, so it is mounted once here rather than by renderAll. Every
// panel builds its teaching material whatever the switch says, and the stylesheet hides it under
// the edu-off class on <html> (see .edu in style.css): a flip changes that class alone, so a run in
// flight and the results on screen are left as they are, on whichever page is up.
els.eduToggleSlot.append(renderEducationalToggle());
const syncEducationalClass = (on: boolean): void => {
  document.documentElement.classList.toggle("edu-off", !on);
};
syncEducationalClass(isEducationalEnabled());
onEducationalChange(syncEducationalClass);

// What the app is for, above the file picker: the one card a reader meets before loading anything,
// which is why it is put up whether or not a file has been opened.
els.introCard.append(teachBox(APP_INTRO, "🎓"));

const loader = initFileLoadingUi(els, { onLoaded: renderAll });
// The demo set replaces the bundled sample the app used to ship with: it lives on the EMBER archive
// (see lib/demoArchive.ts) rather than in this repository, and the page that browses it opens a
// chosen file through the same loader the URL box uses.
initDemosPage(els, loader);
initTabs(() => renderAnalysisTab(els.panels.analysis));

// Preloaded (not deferred to first file drop) so the metadata read and the A/B window's decoding
// don't stall on it later, as the original CDN version's eager `ensureMediabunny()` call did.
ensureMediabunny().catch((err: unknown) => {
  console.warn("[encoding-helper] mediabunny preload failed:", err);
});
