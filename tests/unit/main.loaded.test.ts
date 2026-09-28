// @vitest-environment jsdom
// What main.ts does once a file has loaded: the file loader and the tab renderers are stubbed (each
// has its own suite), so what is pinned here is main.ts's wiring between them. The loader it builds
// is the one the demos page opens files through; a load draws every tab, the Inspect panel in the
// file's own reading order; the Educational switch redraws them while a file is up; and the Full
// Analysis tab is rebuilt on every visit.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setEducationalEnabled } from "../../src/lib/educational";
import { bootMain, el } from "./helpers/mainHarness";

const calls = vi.hoisted(() => [] as [string, string][]);
const loader = vi.hoisted(() => ({ loadFile: vi.fn(), loadUrl: vi.fn() }));
const fileLoading = vi.hoisted(() => ({ onLoaded: null as null | (() => void), els: null as unknown }));
const demosPage = vi.hoisted(() => ({ loader: null as unknown }));

vi.mock("../../src/ui/fileLoading", () => ({
  initFileLoadingUi: (els: unknown, callbacks: { onLoaded: () => void }) => {
    fileLoading.els = els;
    fileLoading.onLoaded = callbacks.onLoaded;
    return loader;
  },
}));
vi.mock("../../src/ui/demosPage", () => ({
  initDemosPage: (_els: unknown, given: unknown) => {
    demosPage.loader = given;
  },
}));

// Each renderer notes which panel it drew into and leaves a mark there, so the panel's clearing
// between loads shows.
function recorder(name: string) {
  return (panel: HTMLElement) => {
    calls.push([name, panel.id]);
    const mark = document.createElement("i");
    mark.className = name;
    panel.append(mark);
  };
}
vi.mock("../../src/ui/inspectTab", () => ({
  renderInspectHead: recorder("renderInspectHead"),
  renderInspectTail: recorder("renderInspectTail"),
}));
vi.mock("../../src/ui/atomsTab", () => ({ renderAtomMap: recorder("renderAtomMap") }));
vi.mock("../../src/ui/seekTab", () => ({ renderSeekTab: recorder("renderSeekTab") }));
vi.mock("../../src/ui/inspectToc", () => ({ mountInspectToc: recorder("mountInspectToc") }));
vi.mock("../../src/ui/encodeTab", () => ({ renderEncodeTab: recorder("renderEncodeTab") }));
vi.mock("../../src/ui/compareTab", () => ({ renderCompareTab: recorder("renderCompareTab") }));
vi.mock("../../src/ui/analysisTab", () => ({ renderAnalysisTab: recorder("renderAnalysisTab") }));

const RENDER_ALL: [string, string][] = [
  ["renderInspectHead", "panel-inspect"],
  ["renderAtomMap", "panel-inspect"],
  ["renderSeekTab", "panel-inspect"],
  ["renderInspectTail", "panel-inspect"],
  ["mountInspectToc", "panel-inspect"],
  ["renderEncodeTab", "panel-encode"],
  ["renderCompareTab", "panel-compare"],
  ["renderAnalysisTab", "panel-analysis"],
];

beforeAll(async () => {
  await bootMain();
});

beforeEach(() => {
  calls.length = 0;
});

describe("main.ts with a file loaded", () => {
  it("hands the page's elements to the loader, and the loader to the demos page", () => {
    expect(fileLoading.els).toMatchObject({ dropZone: el("dropZone"), app: el("app") });
    expect(demosPage.loader).toBe(loader);
    expect(calls).toEqual([]);
  });

  it("draws every tab once a file loads, Inspect in the file's reading order", () => {
    fileLoading.onLoaded!();
    expect(calls).toEqual(RENDER_ALL);
    expect(Array.from(el("panel-inspect").children, (c) => c.className)).toEqual([
      "renderInspectHead",
      "renderAtomMap",
      "renderSeekTab",
      "renderInspectTail",
      "mountInspectToc",
    ]);
  });

  it("empties the Inspect panel before drawing the next file into it", () => {
    fileLoading.onLoaded!();
    expect(calls).toEqual(RENDER_ALL);
    expect(el("panel-inspect").childElementCount).toBe(5);
  });

  it("leaves the tabs alone when the switch flips with no file on screen", () => {
    el("app").style.display = "none";
    setEducationalEnabled(false);
    expect(calls).toEqual([]);
    setEducationalEnabled(true);
    expect(calls).toEqual([]);
  });

  it("redraws every tab when the switch flips with a file on screen", () => {
    el("app").style.display = "";
    setEducationalEnabled(false);
    expect(calls).toEqual(RENDER_ALL);
    expect(el("introCard").querySelector(".teach")?.classList.contains("edu-off")).toBe(true);
    setEducationalEnabled(true);
  });

  it("rebuilds Full Analysis each time its tab is opened", () => {
    const tab = document.querySelector<HTMLButtonElement>('[data-tab="analysis"]')!;
    tab.click();
    tab.click();
    expect(calls).toEqual([
      ["renderAnalysisTab", "panel-analysis"],
      ["renderAnalysisTab", "panel-analysis"],
    ]);
    expect(el("panel-analysis").classList.contains("on")).toBe(true);
  });
});
