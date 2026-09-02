// The demo set: a couple of dozen short videos, each varying exactly one thing this app surfaces
// (atom layout, container, codec and profile, GOP structure, bitrate behaviour, track properties,
// metadata tags), generated and published by scripts/generate-demos.sh.
//
// They live on the EMBER archive rather than in this repository, because a video blob committed
// once sits in the git history forever — the same reason the generator fetches its source recording
// from there instead of carrying it. So the app reads them over the network, from the BEP047
// dataset the generator writes:
//
//   dataset_description.json                                 <- the index, under "encoding-helper"
//   sub-01/ses-<label>/beh/sub-01_ses-<label>_video.<ext>     <- the demo file
//   sub-01/ses-<label>/beh/sub-01_ses-<label>_video.json      <- its BEP047 sidecar
//
// Two requests draw the whole list: one asset listing (paths, sizes and the ids the download URLs
// are built from) and one fetch of dataset_description.json, whose "encoding-helper" key names
// every session's title, group and description. A dataset written by a generator older than that
// index carried no descriptions, so a demo without one falls back to its own BEP047 sidecar, which
// costs a request per file — the reason the generator writes them into the index at all.

/** The EMBER archive's DANDI API, and the dandiset scripts/upload-demos.sh publishes into. */
const EMBER_API = "https://api-dandi.emberarchive.org/api";
export const EMBER_DANDISET = "000527";
const EMBER_VERSION = "draft";

/** One demo file, as the demos page shows it before anyone opens its card. */
export interface DemoFile {
  /** The BIDS session label, unique across the set: "reference", "goplong", … */
  session: string;
  title: string;
  group: string;
  /** Whether mp4box.js can parse it at all — false for the Matroska/WebM/AVI files. */
  loadsInApp: boolean;
  /** What the file demonstrates. Null when the index predates carrying it; see fetchDemoDescription. */
  description: string | null;
  /** Path within the dataset, which is also the file name the app loads it under. */
  path: string;
  fileName: string;
  ext: string;
  size: number;
  videoUrl: string;
  /** The BEP047 sidecar beside it, absent only if the upload lost it. */
  sidecarUrl: string | null;
}

export interface DemoSet {
  demos: DemoFile[];
}

/**
 * The headings the page sorts the demo files under, in the order it shows them.
 *
 * A heading names its theme and nothing more: what a file is is the file's own business, and the
 * card that opens on a tile says it. A heading can cover more than one of the generator's group
 * names: the source recording and the baseline encode are one thing to a reader — where the set
 * starts — so they share a row, the recording first and the encode made from it second. Anything
 * the generator grows later still appears, at the end, under its own raw name.
 */
interface DemoGroup {
  /** The generator's group names this heading covers, in the order their files should appear. */
  ids: readonly string[];
  title: string;
}

export const DEMO_GROUPS: readonly DemoGroup[] = [
  { ids: ["original", "reference"], title: "Start here" },
  { ids: ["recommended"], title: "A recommended encode" },
  // The themes from here down run outermost-in and most-consequential-first: the box the stream
  // sits in, how that box is laid out, the stream itself, and the structure inside the stream that
  // decides how it seeks. What only describes a file rather than changing how it behaves — its
  // track properties, its tags, the rate it was told to hit — comes after all of that.
  { ids: ["container"], title: "Containers" },
  { ids: ["layout"], title: "Atom layout" },
  { ids: ["codec"], title: "Codecs and profiles" },
  { ids: ["gop"], title: "Group of Pictures (GOP) and keyframe structure" },
  { ids: ["track"], title: "Track properties" },
  { ids: ["metadata"], title: "Metadata tags" },
  { ids: ["bitrate"], title: "Bitrate behaviour" },
];
/** A session's line in dataset_description.json's own index. */
interface SessionEntry {
  title?: string;
  group?: string;
  loads_in_app?: boolean;
  description?: string;
}

interface DatasetDescription {
  "encoding-helper"?: { sessions?: Record<string, SessionEntry> };
}

interface ArchiveAsset {
  asset_id?: string;
  path?: string;
  size?: number;
}

interface AssetPage {
  results?: ArchiveAsset[];
  next?: string | null;
}

/** The asset listing is paginated; this many pages covers a demo set an order of magnitude larger. */
const MAX_ASSET_PAGES = 20;
const ASSET_PAGE_SIZE = 200;

/** The dataset path of a BEP047 media file, capturing the session label and the extension. */
const VIDEO_PATH_RE = /(?:^|\/)ses-([A-Za-z0-9]+)\/[^/]+\/[^/]*_video\.([A-Za-z0-9]+)$/;

const DESCRIPTION_PATH = "dataset_description.json";

/** Where the archive serves one asset's bytes. Redirects to storage, so it is fetchable directly. */
export function assetDownloadUrl(assetId: string): string {
  return `${EMBER_API}/dandisets/${EMBER_DANDISET}/versions/${EMBER_VERSION}/assets/${assetId}/download/`;
}

async function fetchJson<T>(url: string): Promise<T> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`);
  return (await resp.json()) as T;
}

async function listAssets(): Promise<ArchiveAsset[]> {
  const first =
    `${EMBER_API}/dandisets/${EMBER_DANDISET}/versions/${EMBER_VERSION}/assets/` +
    `?metadata=false&page_size=${ASSET_PAGE_SIZE}`;
  const out: ArchiveAsset[] = [];
  let next: string | null = first;
  for (let page = 0; next && page < MAX_ASSET_PAGES; page++) {
    const body: AssetPage = await fetchJson<AssetPage>(next);
    out.push(...(body.results ?? []));
    next = body.next ?? null;
  }
  return out;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/**
 * Where a group sorts: which heading it falls under, then where it sits among the group names that
 * heading covers. A group no heading names sorts to the end, after everything the page knows.
 */
function groupRank(id: string): [number, number] {
  const heading = DEMO_GROUPS.findIndex((g) => g.ids.includes(id));
  if (heading === -1) return [DEMO_GROUPS.length, 0];
  return [heading, DEMO_GROUPS[heading].ids.indexOf(id)];
}

/**
 * Joins the archive's asset listing to dataset_description.json's index.
 *
 * The listing is the authority on what is actually published — a session named in the index whose
 * video never made it up is dropped — and the index is the authority on what each file is. A video
 * the index says nothing about is still listed, under its own file name, so a demo added by a newer
 * generator run than the one that wrote the index does not simply vanish from the page.
 */
export function buildDemoSet(desc: DatasetDescription, assets: ArchiveAsset[]): DemoSet {
  const sessions = desc["encoding-helper"]?.sessions ?? {};
  const order = Object.keys(sessions);
  const sidecars = new Map<string, string>();
  const videos: { session: string; path: string; ext: string; size: number; assetId: string }[] = [];

  for (const asset of assets) {
    const path = asset.path;
    const assetId = asset.asset_id;
    if (!path || !assetId) continue;
    const match = VIDEO_PATH_RE.exec(path);
    if (!match) continue;
    // The sidecar matches the same shape as the video it sits beside, so it is separated by
    // extension rather than by a pattern of its own.
    if (match[2] === "json") sidecars.set(match[1], assetDownloadUrl(assetId));
    else videos.push({ session: match[1], path, ext: match[2], size: asset.size ?? 0, assetId });
  }

  const demos: DemoFile[] = videos.map((video) => {
    const entry: SessionEntry = sessions[video.session] ?? {};
    const fileName = video.path.slice(video.path.lastIndexOf("/") + 1);
    return {
      session: video.session,
      title: entry.title ?? fileName,
      group: entry.group ?? "other",
      // Nothing said means nothing known, and the app should offer to try rather than refuse.
      loadsInApp: entry.loads_in_app ?? true,
      description: stringOrNull(entry.description),
      path: video.path,
      fileName,
      ext: video.ext,
      size: video.size,
      videoUrl: assetDownloadUrl(video.assetId),
      sidecarUrl: sidecars.get(video.session) ?? null,
    };
  });

  demos.sort((a, b) => {
    const [aHeading, aWithin] = groupRank(a.group);
    const [bHeading, bWithin] = groupRank(b.group);
    if (aHeading !== bHeading) return aHeading - bHeading;
    if (aWithin !== bWithin) return aWithin - bWithin;
    // Within a group, the order the generator wrote them in; anything unindexed trails it.
    const ai = order.indexOf(a.session);
    const bi = order.indexOf(b.session);
    return (ai === -1 ? order.length : ai) - (bi === -1 ? order.length : bi);
  });

  return { demos };
}

/** Reads the published demo set off the archive. Throws with the reason the page should show. */
export async function fetchDemoSet(): Promise<DemoSet> {
  const assets = await listAssets();
  const description = assets.find((a) => a.path === DESCRIPTION_PATH);
  if (!description?.asset_id) {
    throw new Error(`Dandiset ${EMBER_DANDISET} carries no ${DESCRIPTION_PATH}, so there is no demo set to list.`);
  }
  const desc = await fetchJson<DatasetDescription>(assetDownloadUrl(description.asset_id));
  const set = buildDemoSet(desc, assets);
  if (set.demos.length === 0) throw new Error(`No demo files have been published to dandiset ${EMBER_DANDISET} yet.`);
  return set;
}

/**
 * What a demo file shows, from its own BEP047 sidecar.
 *
 * Only for the files whose index entry carries no description: a dataset generated before the index
 * held them needs one request per file to say anything about them, which is worth it for the prose
 * the page is built around, but is not the path a current dataset takes.
 */
export async function fetchDemoDescription(demo: DemoFile): Promise<string | null> {
  if (!demo.sidecarUrl) return null;
  const json = await fetchJson<Record<string, unknown>>(demo.sidecarUrl);
  return stringOrNull(json.Description);
}
