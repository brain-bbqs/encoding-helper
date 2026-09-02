// mp4box.js feeding: drip-feed the whole file so mp4box can build both the box tree (for the atom
// map) and the sample table. mp4box honors the offset it requests via appendBuffer's return value,
// so it can jump past large mdat payloads it doesn't need to buffer rather than forcing us to read
// them byte-for-byte.

import MP4Box, { type ISOFile, type MP4BoxBox, type MP4BoxInfo } from "mp4box";
import type { ChunkedSource } from "./chunkedSource";
import type { BoxNode, DeclaredBitrate, SampleAnalysis, SampleInfo } from "./types";

interface Mp4BoxParseResult {
  mp4boxFile: ISOFile;
  info: MP4BoxInfo;
}

export async function parseWithMp4Box(
  source: ChunkedSource,
  onProgress?: (fraction: number) => void,
): Promise<Mp4BoxParseResult> {
  const mp4boxFile = MP4Box.createFile();
  // A plain object (rather than two bare `let`s) so TypeScript can't over-narrow these away as
  // "always null" between the onReady/onError closures being registered and later being read —
  // both are genuinely reassigned asynchronously by mp4box while appendBuffer() runs below.
  const ready: { info: MP4BoxInfo | null; error: string | null } = { info: null, error: null };
  mp4boxFile.onReady = (info) => {
    ready.info = info;
  };
  mp4boxFile.onError = (err) => {
    ready.error = err;
  };

  const CHUNK = 2 * 1024 * 1024;
  let offset = 0;
  let iterations = 0;
  const MAX_ITERATIONS = 200000;
  while (offset < source.size && iterations < MAX_ITERATIONS) {
    const buf = await source.readChunk(offset, CHUNK);
    if (buf.byteLength === 0) break;
    const tagged = buf as ArrayBuffer & { fileStart: number };
    tagged.fileStart = offset;
    const next = mp4boxFile.appendBuffer(tagged);
    offset = next === undefined || next <= offset ? offset + buf.byteLength : next;
    iterations++;
    if (ready.error) throw new Error("mp4box parse error: " + ready.error);
    if (onProgress) onProgress(Math.min(1, offset / source.size));
    await new Promise((r) => setTimeout(r, 0));
  }
  mp4boxFile.flush();
  if (!ready.info) throw new Error("mp4box could not parse this file (moov box not found or incomplete)");
  return { mp4boxFile, info: ready.info };
}

// Flatten mp4box's box tree into a simple, serializable structure for rendering.
export function extractBoxTree(mp4boxFile: ISOFile): BoxNode[] {
  const walk = (box: MP4BoxBox): BoxNode => ({
    type: box.type || "????",
    start: box.start || 0,
    size: box.size || 0,
    hdrSize: box.hdr_size || 0,
    children: Array.isArray(box.boxes) ? box.boxes.map(walk) : [],
  });
  return mp4boxFile.boxes.map(walk);
}

function findTopLevelBox(tree: BoxNode[], type: string): BoxNode | null {
  return tree.find((b) => b.type === type) || null;
}

export function detectFaststart(tree: BoxNode[]): boolean | null {
  const moov = findTopLevelBox(tree, "moov");
  const mdat = findTopLevelBox(tree, "mdat");
  if (!moov || !mdat) return null;
  return moov.start < mdat.start;
}

/**
 * The rates a track's sample entry declares in its `btrt` box, or null when it has none — which is
 * the common case, since `btrt` is optional and most encoders leave it out. Only the sample entries
 * of the requested track are read, so an audio track's declaration is never mistaken for a video
 * track's; the first entry that carries one wins, a file with several being one that switched codec
 * configuration partway through.
 */
export function extractDeclaredBitrate(mp4boxFile: ISOFile, trackId: number): DeclaredBitrate | null {
  const trak = mp4boxFile.moov?.traks?.find((t) => t.tkhd?.track_id === trackId);
  const entries = trak?.mdia?.minf?.stbl?.stsd?.entries ?? [];
  for (const entry of entries) {
    const btrt = entry.btrt;
    if (btrt && typeof btrt.avgBitrate === "number" && typeof btrt.maxBitrate === "number") {
      return { avgBitrate: btrt.avgBitrate, maxBitrate: btrt.maxBitrate };
    }
  }
  return null;
}

/**
 * Whether the container declares the track constant-bitrate: `btrt` giving one and the same number
 * as both the average and the peak is how a file says the rate never moves off it. Anything else,
 * including no `btrt` at all, leaves the question open, and the sample sizes are then the only
 * evidence of what the rate actually did.
 */
export function declaresConstantBitrate(declared: DeclaredBitrate | null | undefined): boolean {
  return declared != null && declared.avgBitrate > 0 && declared.avgBitrate === declared.maxBitrate;
}

// Sample table (decode order) + GOP / keyframe / B-frame analysis.
export function extractSampleAnalysis(mp4boxFile: ISOFile, videoTrackId: number, timescale: number): SampleAnalysis {
  const info = mp4boxFile.getTrackSamplesInfo(videoTrackId);
  if (info.length === 0) throw new Error("No samples found in video track");
  const ts = timescale || 1;
  const samples: SampleInfo[] = info.map((s) => ({
    offset: s.offset,
    size: s.size,
    cts: s.cts,
    dts: s.dts,
    ctsSec: s.cts / ts,
    dtsSec: s.dts / ts,
    is_sync: !!s.is_sync,
    duration: s.duration,
  }));
  const keyframeDecodeIndices: number[] = [];
  samples.forEach((s, i) => {
    if (s.is_sync) keyframeDecodeIndices.push(i);
  });
  const gopLengths: number[] = [];
  for (let i = 0; i < keyframeDecodeIndices.length; i++) {
    const start = keyframeDecodeIndices[i];
    const end = i + 1 < keyframeDecodeIndices.length ? keyframeDecodeIndices[i + 1] : samples.length;
    gopLengths.push(end - start);
  }
  const hasBFrames = samples.some((s) => s.cts !== s.dts);

  // Presentation order (sorted by CTS) with keyframe timestamps, for nearest-keyframe lookups.
  const presentationOrder = samples.slice().sort((a, b) => a.ctsSec - b.ctsSec);
  const keyframeTimestampsSec = presentationOrder.filter((s) => s.is_sync).map((s) => s.ctsSec);

  return { samples, keyframeDecodeIndices, gopLengths, hasBFrames, presentationOrder, keyframeTimestampsSec };
}

// Binary search: largest keyframe timestamp <= t (or null if t is before the first keyframe).
export function nearestKeyframeAtOrBefore(keyframeTimestampsSec: number[], t: number): number | null {
  let lo = 0;
  let hi = keyframeTimestampsSec.length - 1;
  let ans: number | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (keyframeTimestampsSec[mid] <= t) {
      ans = keyframeTimestampsSec[mid];
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}
