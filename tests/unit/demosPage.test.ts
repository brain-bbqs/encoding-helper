import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DemoFile, DemoSet } from "../../src/lib/demoArchive";
import { renderDemoBrowser } from "../../src/ui/demosPage";

function demo(session: string, group: string, over: Partial<DemoFile> = {}): DemoFile {
  return {
    session,
    title: `Demo ${session}`,
    group,
    loadsInApp: true,
    description: `What ${session} demonstrates.`,
    path: `sub-01/ses-${session}/beh/sub-01_ses-${session}_video.mp4`,
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
    demo("matroska", "container", { title: "Matroska container", loadsInApp: false, ext: "mkv" }),
    demo("gopshort", "gop", { title: "Short GOP" }),
    demo("goplong", "gop", { title: "Long GOP" }),
  ],
};

const OPTS = { search: "", onOpen: (): void => {} };

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
    expect(container.querySelectorAll(".demo-tile").length).toBe(5);
    const headings = [...container.querySelectorAll(".demos-group h2")].map((h) => h.textContent);
    expect(headings).toEqual(["Start here", "Containers", "GOP and keyframe structure"]);
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
});
