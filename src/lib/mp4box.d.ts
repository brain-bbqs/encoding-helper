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
    audioTracks: MP4BoxTrackInfo[];
  }

  /** A raw parsed box as produced by mp4box's internal BoxParser; only the fields this app reads. */
  export interface MP4BoxBox {
    type?: string;
    fourcc?: string;
    start?: number;
    size?: number;
    hdr_size?: number;
    boxes?: MP4BoxBox[];
  }

  export interface ISOFile {
    onReady: ((info: MP4BoxInfo) => void) | null;
    onError: ((error: string) => void) | null;
    boxes: MP4BoxBox[];
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
