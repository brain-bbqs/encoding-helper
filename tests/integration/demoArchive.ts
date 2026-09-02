// Stands in for the EMBER archive the demos page reads (src/lib/demoArchive.ts), so the browser
// runs neither reach the network nor depend on what is published at any given moment.
//
// The shape is the archive's own: one paginated asset listing, one dataset_description.json whose
// "encoding-helper" key indexes the sessions, one BEP047 sidecar per file, and the video bytes
// behind each asset's download endpoint. Every demo serves the same generated video
// (tests/fixtures/demoVideo.ts) — the point under test is the page, not the encodes.

import { readFileSync } from "node:fs";
import { expect, type Page, type Route } from "@playwright/test";
import { buildFixtureVideo } from "../fixtures/demoVideo";

const ASSETS_URL = "https://api-dandi.emberarchive.org/api/dandisets/000527/versions/draft/assets";

/** The session the tests load unless they say otherwise: the set's baseline encode. */
const REFERENCE_SESSION = "reference";
export const REFERENCE_FILE_NAME = `sub-01_ses-${REFERENCE_SESSION}_video.mp4`;

interface FakeDemo {
  session: string;
  ext: string;
  group: string;
  title: string;
  loadsInApp: boolean;
  description: string;
  /** Left off for one file, so the "published without a sidecar" path is exercised too. */
  sidecar?: boolean;
}

const FAKE_DEMOS: FakeDemo[] = [
  {
    session: "original",
    ext: "m4v",
    group: "original",
    title: "The original recording, unmodified",
    loadsInApp: true,
    description: "The unmodified source recording. Every other session is a transcoding of this.",
    sidecar: true,
  },
  {
    session: REFERENCE_SESSION,
    ext: "mp4",
    group: "reference",
    title: "Reference: H.264 High in MP4, faststart",
    loadsInApp: true,
    description: "The baseline of the demo set. Every other demo file changes one thing from this.",
    sidecar: true,
  },
  {
    session: "recommended",
    ext: "mp4",
    group: "recommended",
    title: "Recommended: seekable, streamable and small",
    loadsInApp: true,
    description: "The one file here that is a recommendation rather than a demonstration.",
    sidecar: true,
  },
  {
    session: "nofaststart",
    ext: "mp4",
    group: "layout",
    title: "Not faststart: moov after mdat",
    loadsInApp: true,
    description: "The same encode without +faststart, so the moov atom lands after mdat.",
    sidecar: true,
  },
  {
    session: "goplong",
    ext: "mp4",
    group: "gop",
    title: "Long GOP: keyframe every ten seconds",
    loadsInApp: true,
    description: "A keyframe only every 300 frames, so seeking must decode its way to a target.",
    sidecar: true,
  },
  {
    session: "matroska",
    ext: "mkv",
    group: "container",
    title: "Matroska container (.mkv)",
    loadsInApp: false,
    description: "EBML elements instead of MP4 atoms, so the MP4 parse step fails on purpose.",
  },
];

function assetId(session: string, kind: "video" | "sidecar"): string {
  return `${session}-${kind}`;
}

function videoPath(demo: FakeDemo): string {
  return `sub-01/ses-${demo.session}/beh/sub-01_ses-${demo.session}_video.${demo.ext}`;
}

function listing(videoSize: number): unknown {
  const results: unknown[] = [{ asset_id: "description", path: "dataset_description.json", size: 2048 }];
  for (const demo of FAKE_DEMOS) {
    results.push({ asset_id: assetId(demo.session, "video"), path: videoPath(demo), size: videoSize });
    if (demo.sidecar) {
      results.push({
        asset_id: assetId(demo.session, "sidecar"),
        path: videoPath(demo).replace(/\.[^.]+$/, ".json"),
        size: 512,
      });
    }
  }
  return { count: results.length, next: null, results };
}

function datasetDescription(): unknown {
  const sessions: Record<string, unknown> = {};
  for (const demo of FAKE_DEMOS) {
    sessions[demo.session] = {
      title: demo.title,
      group: demo.group,
      loads_in_app: demo.loadsInApp,
      // The matroska demo is left out of the index's descriptions as well as its sidecar, so the
      // "nothing to say about this one" path is on screen too.
      ...(demo.sidecar ? { description: demo.description } : {}),
    };
  }
  return {
    Name: "encoding-helper demos",
    BIDSVersion: "1.10.0",
    License: "CC-BY-4.0",
    SourceDatasets: [{ Name: "Multi-Modal Courtship in the Peacock Spider", URL: "https://example.org/article" }],
    "encoding-helper": { source: "Video_S1.m4v", sessions },
  };
}

function sidecar(demo: FakeDemo): unknown {
  return {
    Description: demo.description,
    RecordingDuration: 30.0,
    VideoFrameRate: 30,
    VideoFrameCount: 900,
    ImageWidth: 320,
    ImageHeight: 240,
    ImagePixelFormat: "yuv420p",
    ImageBitDepth: 8,
    VideoCodec: "h264",
    VideoCodecRFC6381: "avc1.64001e",
  };
}

/** Fulfilled responses cross an origin, so every one of them has to say so. */
const CORS = { "Access-Control-Allow-Origin": "*" };

async function fulfillJson(route: Route, body: unknown): Promise<void> {
  await route.fulfill({ status: 200, headers: CORS, contentType: "application/json", body: JSON.stringify(body) });
}

/** Serves the whole fake archive to `page`. Call it before navigating. */
export async function mockDemoArchive(page: Page): Promise<void> {
  const video = readFileSync(buildFixtureVideo());
  await page.route(`${ASSETS_URL}/**`, async (route) => {
    const url = route.request().url();
    const id = /\/assets\/([^/]+)\/download\//.exec(url)?.[1];
    if (!id) return fulfillJson(route, listing(video.byteLength));
    if (id === "description") return fulfillJson(route, datasetDescription());
    const demo = FAKE_DEMOS.find((d) => id === assetId(d.session, "video") || id === assetId(d.session, "sidecar"));
    if (!demo) return route.fulfill({ status: 404, headers: CORS, body: "no such asset" });
    if (id.endsWith("-sidecar")) return fulfillJson(route, sidecar(demo));
    // The real archive signs its storage URLs for GET alone, so a HEAD comes back 403 on a file
    // that is public; refused here too, so the app's fallback is what these tests actually run.
    if (route.request().method() === "HEAD") {
      await route.fulfill({ status: 403, headers: CORS, body: "" });
      return;
    }
    // No Accept-Ranges and no 206, so the app keeps the whole body it is given rather than asking
    // for byte ranges the route would have to serve itself.
    await route.fulfill({ status: 200, headers: CORS, contentType: "video/mp4", body: video });
  });
}

/** The demos page, with the archive mocked. `query` is appended to `?demos`, e.g. `&tab=encode`. */
export async function gotoDemos(page: Page, query = ""): Promise<void> {
  await mockDemoArchive(page);
  await page.goto(`/?demos${query}`);
  await expect(page.locator(".demo-tile").first()).toBeVisible();
}

/** Opens one demo's fold and loads it, leaving the app showing that file. */
export async function loadDemo(page: Page, session = REFERENCE_SESSION, query = ""): Promise<void> {
  await gotoDemos(page, query);
  await page.locator(`.demo-tile[data-session="${session}"]`).click();
  await page.locator(`.demo-card[data-session="${session}"] .demo-open`).click();
  await expect(page.locator("#app")).toBeVisible();
}
