import "./style.css";
import { ensureMediabunny } from "./lib/mediabunny";
import { renderAtomMap } from "./ui/atomsTab";
import { renderEncodeTestTab } from "./ui/compareTab";
import { getElements } from "./ui/elements";
import { renderEncodeTab } from "./ui/encodeTab";
import { initFileLoadingUi } from "./ui/fileLoading";
import { renderInspect } from "./ui/inspectTab";
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
  renderReportTab(els.panels.report, els.printArea);
}

// Footer version stamp; the anchor itself already points at the source repository.
els.appVersionLink.textContent = `v${__APP_VERSION__}`;
els.appVersionLink.title = `Encoding Helper v${__APP_VERSION__}: view the source on GitHub`;

initFileLoadingUi(els, { onLoaded: renderAll });
initTabs(() => renderReportTab(els.panels.report, els.printArea));

// Preloaded (not deferred to first file drop) so the fast/exact engine checks in the Re-encode tab
// don't stall on it later — matches the original CDN version's eager `ensureMediabunny()` call.
ensureMediabunny().catch((err: unknown) => {
  console.warn("[encoding-helper] mediabunny preload failed:", err);
});
