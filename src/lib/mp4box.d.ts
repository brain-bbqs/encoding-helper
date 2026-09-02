// mp4box (https://github.com/gpac/mp4box.js) ships no TypeScript types at all — its dist bundle is a
// plain UMD/CJS build that just assigns `exports.createFile = MP4Box.createFile`. This declares the
// minimal surface this app actually uses (box tree + sample table), not the whole library.
declare module "mp4box" {
  export interface MP4BoxSample {
    offset: number;
    size: number;
    cts: number;
    dts: number;
    is_sync: boolean;
    duration: number;
  }

  export interface MP4BoxTrackInfo {
    id: number;
    timescale: number;
  }

  export interface MP4BoxInfo {
    videoTracks: MP4BoxTrackInfo[];
  }

  /** A raw parsed box as produced by mp4box's internal BoxParser; only the fields this app reads. */
  export interface MP4BoxBox {
    type?: string;
    start?: number;
    size?: number;
    hdr_size?: number;
    boxes?: MP4BoxBox[];
  }

  /** The `btrt` BitRateBox, which declares a track's own rates in bits per second. */
  export interface MP4BoxBitRateBox {
    bufferSizeDB?: number;
    maxBitrate?: number;
    avgBitrate?: number;
  }

  /**
   * One `stsd` entry: the codec-specific sample entry (`avc1`, `hvc1`, `mp4a`, …). mp4box hangs a
   * container's children off it by name as well as collecting them in `boxes`, so the optional
   * child boxes this app reads are named fields here.
   */
  export interface MP4BoxSampleEntry {
    type?: string;
    btrt?: MP4BoxBitRateBox;
  }

  /**
   * A `trak` and the chain down to its sample entries, named the way mp4box stores them. Every
   * level is optional because a truncated or malformed file can leave any of them unparsed.
   */
  export interface MP4BoxTrak {
    tkhd?: { track_id?: number };
    mdia?: { minf?: { stbl?: { stsd?: { entries?: MP4BoxSampleEntry[] } } } };
  }

  export interface ISOFile {
    onReady: ((info: MP4BoxInfo) => void) | null;
    onError: ((error: string) => void) | null;
    boxes: MP4BoxBox[];
    /** Set once the `moov` has been parsed, which onReady having fired implies. */
    moov?: { traks?: MP4BoxTrak[] };
    appendBuffer(data: ArrayBuffer & { fileStart: number }): number | undefined;
    flush(): void;
    getTrackSamplesInfo(trackId: number): MP4BoxSample[];
  }

  interface MP4BoxNamespace {
    createFile(keepMdatData?: boolean): ISOFile;
  }

  const MP4Box: MP4BoxNamespace;
  export default MP4Box;
}
