import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { demoVideoPath } from "../fixtures/demoPaths";
import { assetDownloadUrl, EMBER_DANDISET, type DemoFile, type DemoSet } from "../../src/lib/demoArchive";
import { getElements, type AppElements } from "../../src/ui/elements";
import { initDemosPage, renderDemoBrowser } from "../../src/ui/demosPage";

function demo(session: string, group: string, over: Partial<DemoFile> = {}): DemoFile {
  return {
    session,
    title: `Demo ${session}`,
    group,
    loadsInApp: true,
    description: `What ${session} demonstrates.`,
    path: demoVideoPath(session, "mp4"),
    fileName: `sub-01_ses-${session}_video.mp4`,
    ext: "mp4",
    size: 1_048_576,
    videoUrl: `https://archive.test/${session}`,
    sidecarUrl: `https://archive.test/${session}.json`,
    ...over,
  };
}

// In the order buildDemoSet hands them over: the recording, then the baseline, then the rest.
const SET: DemoSet = {
  demos: [
    demo("original", "original", { title: "The original recording", ext: "m4v" }),
    demo("reference", "reference", { title: "Reference: H.264 High in MP4" }),
    demo("recommended", "recommended", { title: "Recommended: seekable, streamable and small" }),
    demo("matroska", "container", { title: "Matroska container", loadsInApp: false, ext: "mkv" }),
    demo("gopshort", "gop", { title: "Short GOP" }),
    demo("goplong", "gop", { title: "Long GOP" }),
  ],
};

const OPTS = { search: "", onOpen: (): void => {} };

/** Lets a fetch that has already answered run its .then chain through. */
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

let container: HTMLDivElement;

// A demo whose index entry carries no description fetches one; every test therefore runs against a
// stub that never settles, and the ones that care about that fetch install their own.
beforeEach(() => {
  container = document.createElement("div");
  document.body.replaceChildren(container);
  vi.stubGlobal("fetch", () => new Promise(() => {}));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("renderDemoBrowser", () => {
  it("draws one tile per file, under a heading per group", () => {
    renderDemoBrowser(container, SET, OPTS);
    expect(container.querySelectorAll(".demo-tile").length).toBe(6);
    const headings = [...container.querySelectorAll(".demos-group h2")].map((h) => h.textContent);
    expect(headings).toEqual([
      "Start here",
      "A recommended encode",
      "Containers",
      "Group of Pictures (GOP) and keyframe structure",
    ]);
  });

  it("puts the recording and the baseline encode on the same row, the recording first", () => {
    renderDemoBrowser(container, SET, OPTS);
    const first = container.querySelector(".demos-group") as HTMLElement;
    const sessions = [...first.querySelectorAll<HTMLElement>(".demo-tile")].map((t) => t.dataset.session);
    expect(sessions).toEqual(["original", "reference"]);
  });

  it("opens on the first tile rather than on an empty card", () => {
    renderDemoBrowser(container, SET, OPTS);
    const card = container.querySelector(".demo-card") as HTMLElement;
    expect(card.dataset.session).toBe("original");
    expect(card.querySelector(".demo-title")?.textContent).toBe("The original recording");
    expect(container.querySelectorAll(".demo-card").length).toBe(1);
  });

  it("fills the card from whichever tile is pressed, and marks that tile", () => {
    renderDemoBrowser(container, SET, OPTS);
    const card = container.querySelector(".demo-card") as HTMLElement;
    const tile = container.querySelector<HTMLButtonElement>('.demo-tile[data-session="goplong"]');
    tile?.click();
    expect(card.dataset.session).toBe("goplong");
    expect(card.querySelector(".demo-title")?.textContent).toBe("Long GOP");
    expect(card.querySelector(".demo-desc")?.textContent).toBe("What goplong demonstrates.");
    expect(tile?.getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector('.demo-tile[data-session="original"]')?.getAttribute("aria-pressed")).toBe("false");
  });

  it("marks the files the MP4 parser cannot open, and still offers to try", () => {
    renderDemoBrowser(container, SET, OPTS);
    const tile = container.querySelector<HTMLButtonElement>('.demo-tile[data-session="matroska"]');
    expect(tile?.querySelector(".demo-tile-mark")).not.toBeNull();
    tile?.click();
    const card = container.querySelector(".demo-card") as HTMLElement;
    expect(card.querySelector(".demo-badge")?.textContent).toBe("MP4 parser can't open this");
    expect(card.querySelector(".demo-open")?.textContent).toBe("Open it anyway");
  });

  it("narrows the grid to what the search matches, by title, session, group or extension", () => {
    renderDemoBrowser(container, SET, { ...OPTS, search: "gop" });
    expect(container.querySelectorAll(".demo-tile").length).toBe(2);
    renderDemoBrowser(container, SET, { ...OPTS, search: "mkv" });
    expect(container.querySelectorAll(".demo-tile").length).toBe(1);
    // The card follows the filter down rather than holding a file no longer on screen.
    expect((container.querySelector(".demo-card") as HTMLElement).dataset.session).toBe("matroska");
  });

  it("says so rather than drawing nothing when the filter matches no file", () => {
    renderDemoBrowser(container, SET, { ...OPTS, search: "prores" });
    expect(container.querySelectorAll(".demo-tile").length).toBe(0);
    expect(container.querySelector(".demos-empty")?.textContent).toBe("No demo file matches that filter.");
    // Nothing is selected, so there is no card under the grid to show.
    expect(container.querySelector(".demo-card")).toBeNull();
  });

  it("moves the card to sit directly under the themed card whose tile was pressed", () => {
    renderDemoBrowser(container, SET, OPTS);
    const card = container.querySelector(".demo-card") as HTMLElement;
    const groupOf = (session: string): Element =>
      (container.querySelector(`.demo-tile[data-session="${session}"]`) as HTMLElement).closest(".demos-group")!;

    // It opens under the group holding the first tile.
    expect(card.previousElementSibling).toBe(groupOf("original"));

    container.querySelector<HTMLButtonElement>('.demo-tile[data-session="goplong"]')?.click();
    expect(card.previousElementSibling).toBe(groupOf("goplong"));

    container.querySelector<HTMLButtonElement>('.demo-tile[data-session="matroska"]')?.click();
    expect(card.previousElementSibling).toBe(groupOf("matroska"));
    // Still exactly one card, moved rather than duplicated.
    expect(container.querySelectorAll(".demo-card").length).toBe(1);
  });

  it("hands the file the card is showing to onOpen", () => {
    const onOpen = vi.fn();
    renderDemoBrowser(container, SET, { ...OPTS, onOpen });
    container.querySelector<HTMLButtonElement>('.demo-tile[data-session="reference"]')?.click();
    container.querySelector<HTMLButtonElement>(".demo-open")?.click();
    expect(onOpen.mock.calls.length).toBe(1);
    expect((onOpen.mock.calls[0][0] as DemoFile).session).toBe("reference");
  });

  it("offers the download link under the file's own name", () => {
    renderDemoBrowser(container, SET, OPTS);
    container.querySelector<HTMLButtonElement>('.demo-tile[data-session="reference"]')?.click();
    const link = container.querySelector<HTMLAnchorElement>(".demo-download");
    expect(link?.download).toBe("sub-01_ses-reference_video.mp4");
    expect(link?.href).toBe("https://archive.test/reference");
  });

  // Only a dataset generated before the index carried descriptions leaves one to fetch.
  it("falls back to the sidecar for a file the index says nothing about, once per file", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ Description: "Read from the sidecar." }) }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const older = { demos: SET.demos.map((d) => ({ ...d, description: null })) };
    renderDemoBrowser(container, older, OPTS);
    const card = container.querySelector(".demo-card") as HTMLElement;
    await vi.waitFor(() => expect(card.querySelector(".demo-desc")?.textContent).toBe("Read from the sidecar."));

    // Pressing away and back reuses what was already read.
    container.querySelector<HTMLButtonElement>('.demo-tile[data-session="reference"]')?.click();
    await vi.waitFor(() => expect(card.querySelector(".demo-desc")?.textContent).toBe("Read from the sidecar."));
    container.querySelector<HTMLButtonElement>('.demo-tile[data-session="original"]')?.click();
    const forOriginal = fetchMock.mock.calls.filter((call) => call[0] === "https://archive.test/original.json");
    expect(forOriginal.length).toBe(1);
  });

  it("leaves the card usable when the sidecar cannot be read either", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve({ ok: false, status: 404, statusText: "Not Found" }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const older = { demos: SET.demos.map((d) => ({ ...d, description: null })) };
    renderDemoBrowser(container, older, OPTS);
    const card = container.querySelector(".demo-card") as HTMLElement;
    expect(card.querySelector(".demo-open")?.textContent).toBe("Open in the app");
    await vi.waitFor(() => expect(warn.mock.calls.length).toBeGreaterThan(0));
    expect(card.querySelector(".demo-desc")?.textContent).toBe("");
    warn.mockRestore();
  });

  it("leaves the description blank when the sidecar carries none", async () => {
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ VideoCodec: "h264" }) }));
    vi.stubGlobal("fetch", fetchMock);
    const older = { demos: SET.demos.map((d) => ({ ...d, description: null })) };
    renderDemoBrowser(container, older, OPTS);
    expect(fetchMock.mock.calls.length).toBe(1);
    await flush();
    expect(container.querySelector(".demo-desc")?.textContent).toBe("");
  });

  // A sidecar that answers after the reader has already pressed another tile must not overwrite
  // that tile's card, but what it said is kept for the next time its own tile is pressed.
  it("does not let a slow sidecar write into a card that has moved on", async () => {
    const answers = new Map<string, (json: Record<string, string>) => void>();
    vi.stubGlobal("fetch", (url: string) =>
      Promise.resolve({
        ok: true,
        json: () => new Promise<Record<string, string>>((resolve) => answers.set(url, resolve)),
      }),
    );
    const older = { demos: SET.demos.map((d) => ({ ...d, description: null })) };
    renderDemoBrowser(container, older, OPTS);
    container.querySelector<HTMLButtonElement>('.demo-tile[data-session="reference"]')?.click();
    await vi.waitFor(() => expect(answers.has("https://archive.test/original.json")).toBe(true));

    answers.get("https://archive.test/original.json")!({ Description: "About the original." });
    await flush();
    const card = container.querySelector(".demo-card") as HTMLElement;
    expect(card.dataset.session).toBe("reference");
    expect(card.querySelector(".demo-desc")?.textContent).toBe("");

    container.querySelector<HTMLButtonElement>('.demo-tile[data-session="original"]')?.click();
    expect(card.querySelector(".demo-desc")?.textContent).toBe("About the original.");
  });

  // A file published outside the index's groups still gets a heading, its own group name.
  it("heads a group the table does not know by its own name, and shows no size for a file without one", () => {
    const set = { demos: [...SET.demos, demo("brandnew", "brandnew", { size: 0 })] };
    renderDemoBrowser(container, set, OPTS);
    const groups = [...container.querySelectorAll<HTMLElement>(".demos-group")];
    const last = groups[groups.length - 1];
    expect(last.querySelector("h2")?.textContent).toBe("brandnew");
    expect(last.dataset.hue).toBe("brandnew");
    expect(last.querySelector(".demo-size")).toBeNull();
    expect(groups[0].querySelector(".demo-size")?.textContent).toBe("1.0 MB");
  });
});

describe("renderDemoBrowser notch", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Lays the page out: the card spans 400px from the left edge, every tile sits at `tileLeft`. */
  function layOut(tileLeft: number): void {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      const isCard = this.classList.contains("demo-card");
      return { left: isCard ? 0 : tileLeft, width: isCard ? 400 : 40 } as DOMRect;
    });
  }

  // The notch points at the middle of the pressed tile, and follows it when the window is resized.
  it("aims the card's notch at the pressed tile and re-aims it on resize", () => {
    layOut(100);
    renderDemoBrowser(container, SET, OPTS);
    const card = container.querySelector(".demo-card") as HTMLElement;
    expect(card.style.getPropertyValue("--notch-x")).toBe("120px");

    layOut(300);
    window.dispatchEvent(new Event("resize"));
    expect(card.style.getPropertyValue("--notch-x")).toBe("320px");
  });

  // A tile in the first or last column would otherwise put the point past the card's rounded corner.
  it("keeps the notch a notch-width clear of the card's corners", () => {
    layOut(-30);
    renderDemoBrowser(container, SET, OPTS);
    const card = container.querySelector(".demo-card") as HTMLElement;
    expect(card.style.getPropertyValue("--notch-x")).toBe("20px");

    layOut(500);
    window.dispatchEvent(new Event("resize"));
    expect(card.style.getPropertyValue("--notch-x")).toBe("380px");
  });
});

describe("initDemosPage", () => {
  const INDEX_HTML = readFileSync(resolve(process.cwd(), "index.html"), "utf8");

  const DESCRIPTION = {
    Name: "encoding-helper demos",
    "encoding-helper": {
      sessions: {
        original: { title: "The original recording", group: "original", loads_in_app: true, description: "Source." },
        reference: { title: "Reference", group: "reference", loads_in_app: true, description: "The baseline." },
        gopshort: { title: "Short GOP", group: "gop", loads_in_app: true, description: "Short." },
      },
    },
  };

  const ASSETS = [
    { asset_id: "desc-id", path: "dataset_description.json", size: 900 },
    { asset_id: "original-id", path: demoVideoPath("original", "m4v"), size: 5_000_000 },
    { asset_id: "reference-id", path: demoVideoPath("reference", "mp4"), size: 3_000_000 },
    { asset_id: "gopshort-id", path: demoVideoPath("gopshort", "mp4"), size: 4_000_000 },
  ];

  /** Serves the archive's asset listing and its dataset_description.json download. */
  function stubArchive(): ReturnType<typeof vi.fn> {
    const fetchMock = vi.fn((url: string) => {
      const body = url === assetDownloadUrl("desc-id") ? DESCRIPTION : { results: ASSETS, next: null };
      return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  let els: AppElements;
  let loader: { loadUrl: Mock<(url: string, name?: string) => Promise<void>> };
  let popstateHandlers: EventListener[];

  /** Wires the page, remembering its popstate listener so the next test does not inherit it. */
  function init(): void {
    const spy = vi.spyOn(window, "addEventListener");
    initDemosPage(els, loader);
    for (const call of spy.mock.calls) {
      if (call[0] === "popstate") popstateHandlers.push(call[1] as EventListener);
    }
    spy.mockRestore();
  }

  const shownSessions = (): string[] =>
    [...els.demosPage.querySelectorAll<HTMLElement>(".demo-tile")].map((t) => t.dataset.session ?? "");

  beforeEach(() => {
    document.body.innerHTML = /<body[^>]*>([\s\S]*)<\/body>/.exec(INDEX_HTML)![1];
    window.history.replaceState({}, "", "/");
    els = getElements();
    loader = { loadUrl: vi.fn(() => Promise.resolve()) };
    popstateHandlers = [];
    stubArchive();
    // jsdom has no layout to scroll, and says so on the console unless it is told not to.
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  });

  afterEach(async () => {
    await flush();
    for (const handler of popstateHandlers) window.removeEventListener("popstate", handler);
    vi.restoreAllMocks();
    window.history.replaceState({}, "", "/");
    document.body.innerHTML = "";
  });

  it("stays out of the way until the button is pressed", () => {
    init();
    expect(els.demosPage.style.display).toBe("none");
    expect(els.demosPage.childElementCount).toBe(0);
    expect(window.location.search).toBe("");
  });

  // The page replaces the drop zone, and the button that opens it sits inside the drop zone, which
  // is itself a click target for the file picker.
  it("opens over the file picker, records itself in the URL and reads the set from the archive", async () => {
    const pushState = vi.spyOn(window.history, "pushState");
    const pickerClick = vi.fn();
    els.dropZone.addEventListener("click", pickerClick);
    els.app.style.display = "block";
    init();

    els.browseDemosBtn.click();
    expect(pickerClick.mock.calls.length).toBe(0);
    expect(window.location.search).toBe("?demos");
    expect(pushState.mock.calls.length).toBe(1);
    expect(els.demosPage.style.display).toBe("block");
    expect(els.dropZone.style.display).toBe("none");
    expect(els.introCard.style.display).toBe("none");
    expect(els.app.style.display).toBe("none");
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0 });
    expect(els.demosPage.querySelector(".demos-loading")?.textContent).toBe("Reading the demo set from the archive…");

    await flush();
    expect(shownSessions()).toEqual(["original", "reference", "gopshort"]);
    expect((els.demosPage.querySelector(".demo-card") as HTMLElement).dataset.session).toBe("original");
  });

  it("puts back what it hid, including a loaded file's tabs, when the back button is pressed", async () => {
    els.app.style.display = "block";
    init();
    els.browseDemosBtn.click();
    await flush();
    const pushState = vi.spyOn(window.history, "pushState");

    els.demosPage.querySelector<HTMLButtonElement>("#demosBackBtn")!.click();
    expect(window.location.search).toBe("");
    expect(pushState.mock.calls.length).toBe(1);
    expect(els.demosPage.style.display).toBe("none");
    expect(els.dropZone.style.display).toBe("");
    expect(els.introCard.style.display).toBe("");
    expect(els.app.style.display).toBe("block");
  });

  // Built on the first visit and kept, so going back and forth costs one read of the archive.
  it("reads the set once however many times the page is opened", async () => {
    const fetchMock = stubArchive();
    init();
    els.browseDemosBtn.click();
    await flush();
    expect(fetchMock.mock.calls.length).toBe(2);
    els.demosPage.querySelector<HTMLButtonElement>("#demosBackBtn")!.click();
    els.browseDemosBtn.click();
    await flush();
    expect(fetchMock.mock.calls.length).toBe(2);
    expect(shownSessions().length).toBe(3);
  });

  it("hands the chosen demo to the loader and gets out of its way first", async () => {
    init();
    els.browseDemosBtn.click();
    await flush();
    const replaceState = vi.spyOn(window.history, "replaceState");
    const pushState = vi.spyOn(window.history, "pushState");

    els.demosPage.querySelector<HTMLButtonElement>('.demo-tile[data-session="reference"]')!.click();
    els.demosPage.querySelector<HTMLButtonElement>(".demo-open")!.click();
    expect(loader.loadUrl.mock.calls).toEqual([[assetDownloadUrl("reference-id"), "sub-01_ses-reference_video.mp4"]]);
    expect(els.demosPage.style.display).toBe("none");
    expect(els.dropZone.style.display).toBe("");
    // Leaving for a file is the app's own doing, so it rewrites the address rather than adding to history.
    expect(window.location.search).toBe("");
    expect(replaceState.mock.calls.length).toBe(1);
    expect(pushState.mock.calls.length).toBe(0);
  });

  it("narrows the grid as the filter box is typed into", async () => {
    init();
    els.browseDemosBtn.click();
    await flush();
    const box = els.demosPage.querySelector<HTMLInputElement>("#demoSearch")!;
    expect(box.getAttribute("aria-label")).toBe("Filter demo files");

    box.value = "  gop ";
    box.dispatchEvent(new Event("input", { bubbles: true }));
    expect(shownSessions()).toEqual(["gopshort"]);

    box.value = "";
    box.dispatchEvent(new Event("input", { bubbles: true }));
    expect(shownSessions().length).toBe(3);
  });

  // Typed before the archive has answered, the filter is remembered and applied once it does.
  it("applies a filter typed while the set is still being read", async () => {
    init();
    els.browseDemosBtn.click();
    const box = els.demosPage.querySelector<HTMLInputElement>("#demoSearch")!;
    box.value = "reference";
    box.dispatchEvent(new Event("input", { bubbles: true }));
    expect(els.demosPage.querySelector(".demos-loading")).not.toBeNull();
    await flush();
    expect(shownSessions()).toEqual(["reference"]);
  });

  it("says why the set could not be read, and offers to try again", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new Error("offline")));
    init();
    els.browseDemosBtn.click();
    await flush();
    const box = els.demosPage.querySelector(".demos-error") as HTMLElement;
    expect(box.querySelector("h2")?.textContent).toBe("Could not read the demo set");
    expect(box.querySelector(".demos-error-why")?.textContent).toBe("offline");
    expect(box.querySelector(".demos-error-hint")?.textContent).toContain(`dandiset ${EMBER_DANDISET}`);
    expect(els.demosPage.querySelectorAll(".demo-tile").length).toBe(0);

    stubArchive();
    box.querySelector("button")!.click();
    expect(els.demosPage.querySelector(".demos-loading")).not.toBeNull();
    await flush();
    expect(els.demosPage.querySelector(".demos-error")).toBeNull();
    expect(shownSessions().length).toBe(3);
  });

  it("opens straight away when the address asks for it", async () => {
    window.history.replaceState({}, "", "/?demos&tab=encode");
    const pushState = vi.spyOn(window.history, "pushState");
    init();
    expect(els.demosPage.style.display).toBe("block");
    expect(els.dropZone.style.display).toBe("none");
    // Restored from the link, so no history entry is added.
    expect(pushState.mock.calls.length).toBe(0);
    expect(window.location.search).toBe("?demos&tab=encode");
    await flush();
    expect(shownSessions().length).toBe(3);
  });

  it("stays closed when the address switches the flag off", () => {
    window.history.replaceState({}, "", "/?demos=0");
    init();
    expect(els.demosPage.style.display).toBe("none");
  });

  // Back and forward walk the page the way the button and its back link imply.
  it("follows the browser's back and forward between the page and the picker", async () => {
    els.app.style.display = "block";
    init();
    els.browseDemosBtn.click();
    await flush();

    window.history.replaceState({}, "", "/");
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(els.demosPage.style.display).toBe("none");
    expect(els.app.style.display).toBe("block");

    window.history.replaceState({}, "", "/?demos");
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(els.demosPage.style.display).toBe("block");
    expect(els.app.style.display).toBe("none");
    expect(shownSessions().length).toBe(3);
  });

  // Landing on a URL without the flag while the page is already down has nothing to undo.
  it("leaves the address alone when told to close a page that is not up", () => {
    init();
    const replaceState = vi.spyOn(window.history, "replaceState");
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(replaceState.mock.calls.length).toBe(0);
    expect(els.demosPage.style.display).toBe("none");
  });

  // Opened twice in a row (a link restored over a page already up), it still remembers what #app
  // looked like before the first opening, not the "none" it set itself.
  it("restores the tabs' display from before the first opening, not from a repeat", async () => {
    els.app.style.display = "block";
    init();
    els.browseDemosBtn.click();
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(els.app.style.display).toBe("none");
    els.demosPage.querySelector<HTMLButtonElement>("#demosBackBtn")!.click();
    expect(els.app.style.display).toBe("block");
  });
});
