import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assetDownloadUrl,
  buildDemoSet,
  fetchDemoDetails,
  fetchDemoSet,
  type DemoFile,
} from "../../src/lib/demoArchive";

/** An asset listing entry, as the archive returns it with `metadata=false`. */
function asset(path: string, assetId: string, size = 1024): Record<string, unknown> {
  return { asset_id: assetId, path, size };
}

function videoPath(session: string, ext: string): string {
  return `sub-01/ses-${session}/beh/sub-01_ses-${session}_video.${ext}`;
}

const DESCRIPTION = {
  Name: "encoding-helper demos",
  Description: "Demo videos for encoding-helper.",
  License: "CC-BY-4.0",
  SourceDatasets: [{ Name: "Peacock spider courtship", URL: "https://example.org/article", License: "CC-BY" }],
  "encoding-helper": {
    sessions: {
      original: { title: "The original recording, unmodified", group: "original", loads_in_app: true },
      reference: {
        title: "Reference",
        group: "reference",
        loads_in_app: true,
        ffmpeg_args: "-i src.m4v -g 90 out.mp4",
      },
      matroska: { title: "Matroska container", group: "container", loads_in_app: false },
      gopshort: { title: "Short GOP", group: "gop", loads_in_app: true },
      goplong: { title: "Long GOP", group: "gop", loads_in_app: true },
    },
  },
};

const ASSETS = [
  asset("dataset_description.json", "desc-id", 900),
  asset(videoPath("original", "m4v"), "original-id", 5_000_000),
  asset(videoPath("original", "json"), "original-json"),
  asset(videoPath("reference", "mp4"), "reference-id", 3_000_000),
  asset(videoPath("reference", "json"), "reference-json"),
  asset(videoPath("matroska", "mkv"), "matroska-id", 2_000_000),
  asset(videoPath("gopshort", "mp4"), "gopshort-id", 4_000_000),
  asset(videoPath("gopshort", "json"), "gopshort-json"),
  asset(videoPath("goplong", "mp4"), "goplong-id", 1_000_000),
  asset(videoPath("goplong", "json"), "goplong-json"),
];

describe("buildDemoSet", () => {
  it("joins the archive listing to the index and orders the files by group", () => {
    const set = buildDemoSet(DESCRIPTION, ASSETS);
    expect(set.demos.map((d) => d.session)).toEqual(["reference", "matroska", "gopshort", "goplong", "original"]);
    expect(set.name).toBe("encoding-helper demos");
    expect(set.license).toBe("CC-BY-4.0");
    expect(set.source?.name).toBe("Peacock spider courtship");
    expect(set.source?.url).toBe("https://example.org/article");
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
    expect(reference.ffmpegArgs).toBe("-i src.m4v -g 90 out.mp4");
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
    const set = buildDemoSet(DESCRIPTION, [...ASSETS, asset(videoPath("brandnew", "mp4"), "brandnew-id", 7)]);
    const last = set.demos[set.demos.length - 1];
    expect(last.session).toBe("brandnew");
    expect(last.group).toBe("other");
    expect(last.title).toBe("sub-01_ses-brandnew_video.mp4");
    // Nothing known means nothing ruled out: the app offers to try rather than refusing.
    expect(last.loadsInApp).toBe(true);
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

  it("says so when the dandiset carries no demo files yet", async () => {
    stubArchive([[asset("dataset_description.json", "desc-id")]]);
    await expect(fetchDemoSet()).rejects.toThrow(/No demo files/);
  });
});

describe("fetchDemoDetails", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const demo = { sidecarUrl: "https://archive.test/sidecar" } as DemoFile;

  it("reads the BEP047 keys the fold shows", async () => {
    vi.stubGlobal("fetch", () =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            Description: "The baseline of the demo set.",
            RecordingDuration: 30.04,
            VideoFrameRate: 29.97,
            VideoFrameCount: 900,
            ImageWidth: 640,
            ImageHeight: 480,
            ImagePixelFormat: "yuv420p",
            ImageBitDepth: 8,
            VideoCodec: "h264",
            VideoCodecRFC6381: "avc1.640028",
          }),
      }),
    );
    const details = await fetchDemoDetails(demo);
    expect(details.description).toBe("The baseline of the demo set.");
    expect(details.duration).toBe(30.04);
    expect(details.frameCount).toBe(900);
    expect(details.codecString).toBe("avc1.640028");
  });

  it("leaves out anything the sidecar does not carry", async () => {
    vi.stubGlobal("fetch", () =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ VideoCodec: "ffv1", ImageWidth: "wide" }) }),
    );
    const details = await fetchDemoDetails(demo);
    expect(details.codec).toBe("ffv1");
    expect(details.width).toBeNull();
    expect(details.description).toBeNull();
  });

  it("refuses a demo published without a sidecar rather than fetching nothing", async () => {
    await expect(fetchDemoDetails({ sidecarUrl: null } as DemoFile)).rejects.toThrow(/without its sidecar/);
  });
});
