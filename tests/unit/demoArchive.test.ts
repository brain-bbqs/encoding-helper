import { afterEach, describe, expect, it, vi } from "vitest";
import { demoVideoPath } from "../fixtures/demoPaths";
import {
  assetDownloadUrl,
  buildDemoSet,
  fetchDemoDescription,
  fetchDemoSet,
  type DemoFile,
} from "../../src/lib/demoArchive";

/** An asset listing entry, as the archive returns it with `metadata=false`. */
function asset(path: string, assetId: string, size = 1024): Record<string, unknown> {
  return { asset_id: assetId, path, size };
}

const DESCRIPTION = {
  Name: "encoding-helper demos",
  Description: "Demo videos for encoding-helper.",
  License: "CC-BY-4.0",
  SourceDatasets: [{ Name: "Peacock spider courtship", URL: "https://example.org/article", License: "CC-BY" }],
  "encoding-helper": {
    sessions: {
      original: { title: "The original recording, unmodified", group: "original", loads_in_app: true },
      reference: { title: "Reference", group: "reference", loads_in_app: true, description: "The baseline." },
      matroska: { title: "Matroska container", group: "container", loads_in_app: false },
      gopshort: { title: "Short GOP", group: "gop", loads_in_app: true },
      goplong: { title: "Long GOP", group: "gop", loads_in_app: true },
    },
  },
};

const ASSETS = [
  asset("dataset_description.json", "desc-id", 900),
  asset(demoVideoPath("original", "m4v"), "original-id", 5_000_000),
  asset(demoVideoPath("original", "json"), "original-json"),
  asset(demoVideoPath("reference", "mp4"), "reference-id", 3_000_000),
  asset(demoVideoPath("reference", "json"), "reference-json"),
  asset(demoVideoPath("matroska", "mkv"), "matroska-id", 2_000_000),
  asset(demoVideoPath("gopshort", "mp4"), "gopshort-id", 4_000_000),
  asset(demoVideoPath("gopshort", "json"), "gopshort-json"),
  asset(demoVideoPath("goplong", "mp4"), "goplong-id", 1_000_000),
  asset(demoVideoPath("goplong", "json"), "goplong-json"),
];

describe("buildDemoSet", () => {
  it("joins the archive listing to the index and orders the files by heading", () => {
    const set = buildDemoSet(DESCRIPTION, ASSETS);
    // The recording and the encode made from it share the leading heading, recording first.
    expect(set.demos.map((d) => d.session)).toEqual(["original", "reference", "matroska", "gopshort", "goplong"]);
  });

  it("carries each file's title, extension, size and download URL", () => {
    const set = buildDemoSet(DESCRIPTION, ASSETS);
    const reference = set.demos.find((d) => d.session === "reference") as DemoFile;
    expect(reference.title).toBe("Reference");
    expect(reference.group).toBe("reference");
    expect(reference.ext).toBe("mp4");
    expect(reference.size).toBe(3_000_000);
    expect(reference.fileName).toBe("sub-01_ses-reference_video.mp4");
    expect(reference.videoUrl).toBe(assetDownloadUrl("reference-id"));
    expect(reference.sidecarUrl).toBe(assetDownloadUrl("reference-json"));
    expect(reference.description).toBe("The baseline.");
  });

  it("keeps the files the index says the MP4 parser cannot open", () => {
    const set = buildDemoSet(DESCRIPTION, ASSETS);
    const matroska = set.demos.find((d) => d.session === "matroska") as DemoFile;
    expect(matroska.loadsInApp).toBe(false);
    // Uploaded without a sidecar of its own, which costs the fold its figures and nothing else.
    expect(matroska.sidecarUrl).toBeNull();
  });

  it("drops a session the index names but the archive does not carry", () => {
    const set = buildDemoSet(
      DESCRIPTION,
      ASSETS.filter((a) => a.asset_id !== "goplong-id"),
    );
    expect(set.demos.some((d) => d.session === "goplong")).toBe(false);
  });

  it("still lists a published file the index says nothing about, after the groups it knows", () => {
    const set = buildDemoSet(DESCRIPTION, [...ASSETS, asset(demoVideoPath("brandnew", "mp4"), "brandnew-id", 7)]);
    const last = set.demos[set.demos.length - 1];
    expect(last.session).toBe("brandnew");
    expect(last.group).toBe("other");
    expect(last.title).toBe("sub-01_ses-brandnew_video.mp4");
    // Nothing known means nothing ruled out: the app offers to try rather than refusing.
    expect(last.loadsInApp).toBe(true);
  });

  // The archive's listing can carry entries with nothing to load, which is not a file to show.
  it("skips a listing entry with no path or no asset id", () => {
    const set = buildDemoSet(DESCRIPTION, [
      ...ASSETS,
      { asset_id: "no-path-id", size: 5 },
      { path: demoVideoPath("nopeid", "mp4"), size: 5 },
    ]);
    expect(set.demos.map((d) => d.session)).toEqual(["original", "reference", "matroska", "gopshort", "goplong"]);
  });

  // An index written before the generator carried its own section says nothing about any file.
  it("lists every file under 'other' when the index has no encoding-helper section", () => {
    const set = buildDemoSet({}, ASSETS);
    expect(set.demos.map((d) => d.session)).toEqual(["original", "reference", "matroska", "gopshort", "goplong"]);
    expect(set.demos.every((d) => d.group === "other" && d.loadsInApp && d.description === null)).toBe(true);
  });

  it("reads a missing size as zero rather than unknown", () => {
    const set = buildDemoSet(DESCRIPTION, [{ asset_id: "sizeless-id", path: demoVideoPath("reference", "mp4") }]);
    expect(set.demos[0].size).toBe(0);
  });
});

describe("fetchDemoSet", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Serves the paginated asset listing and the dataset_description.json download. */
  function stubArchive(pages: Record<string, unknown>[][]): ReturnType<typeof vi.fn> {
    const fetchMock = vi.fn((url: string) => {
      if (url === assetDownloadUrl("desc-id")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(DESCRIPTION) });
      }
      const page = url.includes("page=2") ? 1 : 0;
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            results: pages[page],
            next: page + 1 < pages.length ? "https://archive.test/assets/?page=2" : null,
          }),
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("reads the whole set in two requests when the listing fits one page", async () => {
    const fetchMock = stubArchive([ASSETS]);
    const set = await fetchDemoSet();
    expect(set.demos.length).toBe(5);
    expect(fetchMock.mock.calls.length).toBe(2);
  });

  it("follows the listing's pagination", async () => {
    const fetchMock = stubArchive([ASSETS.slice(0, 5), ASSETS.slice(5)]);
    const set = await fetchDemoSet();
    expect(set.demos.length).toBe(5);
    expect(fetchMock.mock.calls.length).toBe(3);
  });

  it("says so when the dandiset carries no dataset description", async () => {
    stubArchive([ASSETS.filter((a) => a.path !== "dataset_description.json")]);
    await expect(fetchDemoSet()).rejects.toThrow(/dataset_description\.json/);
  });

  it("reports the archive's status when a request fails", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve({ ok: false, status: 404, statusText: "Not Found" }));
    await expect(fetchDemoSet()).rejects.toThrow("404 Not Found");
  });

  it("reads a listing page with no results as empty", async () => {
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchDemoSet()).rejects.toThrow(/dataset_description\.json/);
    expect(fetchMock.mock.calls.length).toBe(1);
  });

  it("says so when the dandiset carries no demo files yet", async () => {
    stubArchive([[asset("dataset_description.json", "desc-id")]]);
    await expect(fetchDemoSet()).rejects.toThrow(/No demo files/);
  });
});

describe("fetchDemoDescription", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const demo = { sidecarUrl: "https://archive.test/sidecar" } as DemoFile;

  it("reads the Description out of the BEP047 sidecar", async () => {
    vi.stubGlobal("fetch", () =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ Description: "The baseline of the demo set.", ImageWidth: 640 }),
      }),
    );
    expect(await fetchDemoDescription(demo)).toBe("The baseline of the demo set.");
  });

  it("gives null when the sidecar carries no usable Description", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve({ ok: true, json: () => Promise.resolve({ VideoCodec: "ffv1" }) }));
    expect(await fetchDemoDescription(demo)).toBeNull();
  });

  it("gives null, rather than fetching, for a demo published without a sidecar", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchDemoDescription({ sidecarUrl: null } as DemoFile)).toBeNull();
    expect(fetchMock.mock.calls.length).toBe(0);
  });
});
