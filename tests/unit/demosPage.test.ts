import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DemoFile, DemoSet } from "../../src/lib/demoArchive";
import { renderDemoList } from "../../src/ui/demosPage";

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

const SET: DemoSet = {
  name: "encoding-helper demos",
  description: null,
  license: "CC-BY-4.0",
  source: null,
  demos: [
    demo("reference", "reference", { title: "Reference: H.264 High in MP4" }),
    demo("matroska", "container", { title: "Matroska container", loadsInApp: false, ext: "mkv" }),
    demo("gopshort", "gop", { title: "Short GOP" }),
    demo("goplong", "gop", { title: "Long GOP" }),
  ],
};

const OPTS = { search: "", onOpen: (): void => {} };

let container: HTMLDivElement;

// A card whose index entry carries no description fetches one; every test therefore runs against a
// stub that never settles, and the ones that care about that fetch install their own.
beforeEach(() => {
  container = document.createElement("div");
  document.body.replaceChildren(container);
  vi.stubGlobal("fetch", () => new Promise(() => {}));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("renderDemoList", () => {
  it("draws one card per file, under a heading per group", () => {
    renderDemoList(container, SET, OPTS);
    expect(container.querySelectorAll("div.demo-card").length).toBe(4);
    const headings = [...container.querySelectorAll(".demos-group h2")].map((h) => h.textContent);
    expect(headings).toEqual(["Reference", "Containers", "GOP and keyframe structure"]);
    // The two GOP files share one card rather than getting a heading each.
    expect(container.querySelectorAll(".demos-group").length).toBe(3);
  });

  it("marks the files the MP4 parser cannot open, and still offers to try", () => {
    renderDemoList(container, SET, OPTS);
    const card = container.querySelector('div.demo-card[data-session="matroska"]') as HTMLElement;
    expect(card.querySelector(".demo-badge")?.textContent).toBe("MP4 parser can't open this");
    expect(card.querySelector(".demo-ext")?.textContent).toBe("MKV");
  });

  it("narrows the list to what the search matches, by title, session, group or extension", () => {
    renderDemoList(container, SET, { ...OPTS, search: "gop" });
    expect(container.querySelectorAll("div.demo-card").length).toBe(2);
    renderDemoList(container, SET, { ...OPTS, search: "mkv" });
    expect(container.querySelectorAll("div.demo-card").length).toBe(1);
  });

  it("says so rather than drawing nothing when the filter matches no file", () => {
    renderDemoList(container, SET, { ...OPTS, search: "prores" });
    expect(container.querySelectorAll("div.demo-card").length).toBe(0);
    expect(container.querySelector(".demos-empty")?.textContent).toBe("No demo file matches that filter.");
  });

  it("hands the picked file to onOpen", () => {
    const onOpen = vi.fn();
    renderDemoList(container, SET, { ...OPTS, onOpen });
    const card = container.querySelector('div.demo-card[data-session="goplong"]') as HTMLElement;
    card.querySelector<HTMLButtonElement>(".demo-open")?.click();
    expect(onOpen.mock.calls.length).toBe(1);
    expect((onOpen.mock.calls[0][0] as DemoFile).session).toBe("goplong");
  });

  it("shows the description the index carried, without a request of its own", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderDemoList(container, SET, OPTS);
    const card = container.querySelector('div.demo-card[data-session="reference"]') as HTMLElement;
    expect(card.querySelector(".demo-desc")?.textContent).toBe("What reference demonstrates.");
    expect(card.querySelector(".demo-open")?.textContent).toBe("Open in the app");
    expect(card.querySelector<HTMLAnchorElement>(".demo-download")?.download).toBe("sub-01_ses-reference_video.mp4");
    expect(fetchMock.mock.calls.length).toBe(0);
  });

  // Only a dataset generated before the index carried descriptions leaves one to fetch.
  it("falls back to the sidecar for a demo the index says nothing about", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ Description: "A keyframe every 15 frames." }) }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const older = { ...SET, demos: SET.demos.map((d) => ({ ...d, description: null })) };
    renderDemoList(container, older, OPTS);
    const card = container.querySelector('div.demo-card[data-session="gopshort"]') as HTMLElement;
    await vi.waitFor(() => expect(card.querySelector(".demo-desc")?.textContent).toBe("A keyframe every 15 frames."));
  });

  it("leaves the card usable when the sidecar cannot be read either", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve({ ok: false, status: 404, statusText: "Not Found" }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const older = { ...SET, demos: SET.demos.map((d) => ({ ...d, description: null })) };
    renderDemoList(container, older, OPTS);
    const card = container.querySelector('div.demo-card[data-session="matroska"]') as HTMLElement;
    expect(card.querySelector(".demo-open")?.textContent).toBe("Open it anyway");
    await vi.waitFor(() => expect(warn.mock.calls.length).toBeGreaterThan(0));
    expect(card.querySelector(".demo-desc")?.textContent).toBe("");
    warn.mockRestore();
  });
});
