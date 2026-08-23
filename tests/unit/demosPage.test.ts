import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DemoFile, DemoSet } from "../../src/lib/demoArchive";
import { renderDemoList } from "../../src/ui/demosPage";

function demo(session: string, group: string, over: Partial<DemoFile> = {}): DemoFile {
  return {
    session,
    title: `Demo ${session}`,
    group,
    loadsInApp: true,
    ffmpegArgs: null,
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

const OPTS = { search: "", loadableOnly: false, onOpen: (): void => {} };

let container: HTMLDivElement;

// jsdom fires a `<details>` toggle event of its own, asynchronously, on top of the ones these tests
// dispatch by hand — so a card opened in one test can reach its handler during the next one. Every
// test therefore runs against a stub, and the ones that care about the sidecar install their own.
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
    expect(container.querySelectorAll("details.demo-card").length).toBe(4);
    const headings = [...container.querySelectorAll(".demos-group h2")].map((h) => h.textContent);
    expect(headings).toEqual(["Reference", "Containers", "GOP and keyframe structure"]);
    // The two GOP files share one card rather than getting a heading each.
    expect(container.querySelectorAll(".demos-group").length).toBe(3);
  });

  it("marks the files the MP4 parser cannot open, and still offers to try", () => {
    renderDemoList(container, SET, OPTS);
    const card = container.querySelector('details.demo-card[data-session="matroska"]') as HTMLElement;
    expect(card.querySelector(".demo-badge")?.textContent).toBe("MP4 parser can't open this");
    expect(card.querySelector(".demo-ext")?.textContent).toBe("MKV");
  });

  it("narrows the list to what the search matches, by title, session, group or extension", () => {
    renderDemoList(container, SET, { ...OPTS, search: "gop" });
    expect(container.querySelectorAll("details.demo-card").length).toBe(2);
    renderDemoList(container, SET, { ...OPTS, search: "mkv" });
    expect(container.querySelectorAll("details.demo-card").length).toBe(1);
  });

  it("hides the files this app cannot open when asked to", () => {
    renderDemoList(container, SET, { ...OPTS, loadableOnly: true });
    expect(container.querySelectorAll("details.demo-card").length).toBe(3);
    expect(container.querySelector('[data-session="matroska"]')).toBeNull();
  });

  it("says so rather than drawing nothing when the filter matches no file", () => {
    renderDemoList(container, SET, { ...OPTS, search: "prores" });
    expect(container.querySelectorAll("details.demo-card").length).toBe(0);
    expect(container.querySelector(".demos-empty")?.textContent).toBe("No demo file matches that filter.");
  });

  it("hands the picked file to onOpen", () => {
    const onOpen = vi.fn();
    renderDemoList(container, SET, { ...OPTS, onOpen });
    const card = container.querySelector('details.demo-card[data-session="goplong"]') as HTMLDetailsElement;
    card.querySelector<HTMLButtonElement>(".demo-open")?.click();
    expect(onOpen.mock.calls.length).toBe(1);
    expect((onOpen.mock.calls[0][0] as DemoFile).session).toBe("goplong");
  });

  it("offers the buttons without waiting on the sidecar", () => {
    // The default stub never settles: the sidecar is still in flight and the fold is already usable.
    renderDemoList(container, SET, OPTS);
    const card = container.querySelector('details.demo-card[data-session="reference"]') as HTMLDetailsElement;
    card.open = true;
    card.dispatchEvent(new Event("toggle"));
    expect(card.querySelector(".demo-open")?.textContent).toBe("Open in the app");
    expect(card.querySelector<HTMLAnchorElement>(".demo-download")?.download).toBe("sub-01_ses-reference_video.mp4");
    expect(card.querySelector(".demo-desc")).toBeNull();
  });

  it("fills a fold from its sidecar the first time it is opened, and only then", async () => {
    const fetchMock = vi.fn((url: string) =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ Description: `Sidecar for ${url}`, ImageWidth: 640, ImageHeight: 480 }),
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    renderDemoList(container, SET, OPTS);
    const card = container.querySelector('details.demo-card[data-session="gopshort"]') as HTMLDetailsElement;
    expect(fetchMock.mock.calls.length).toBe(0);

    card.open = true;
    card.dispatchEvent(new Event("toggle"));
    await vi.waitFor(() =>
      expect(card.querySelector(".demo-desc")?.textContent).toBe("Sidecar for https://archive.test/gopshort.json"),
    );
    expect(card.querySelector(".demo-facts")?.textContent).toContain("640 × 480");

    card.open = false;
    card.dispatchEvent(new Event("toggle"));
    card.open = true;
    card.dispatchEvent(new Event("toggle"));
    const forThisCard = fetchMock.mock.calls.filter((call) => call[0] === "https://archive.test/gopshort.json");
    expect(forThisCard.length).toBe(1);
  });

  it("keeps the buttons when the sidecar cannot be read", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve({ ok: false, status: 404, statusText: "Not Found" }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    renderDemoList(container, SET, OPTS);
    const card = container.querySelector('details.demo-card[data-session="matroska"]') as HTMLDetailsElement;
    card.open = true;
    card.dispatchEvent(new Event("toggle"));
    // The matroska demo has no sidecar of its own, so the fold falls back to what the listing knows.
    await vi.waitFor(() => expect(card.querySelector(".demo-facts")).not.toBeNull());
    expect(card.querySelector(".demo-open")?.textContent).toBe("Open it anyway");
    expect(card.querySelector(".demo-desc")).toBeNull();
    warn.mockRestore();
  });
});
