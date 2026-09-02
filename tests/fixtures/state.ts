// Fixtures the unit tests share for the app's state: the video track most tabs are rendered over,
// the command builder's defaults, and the reset that puts both back between tests.

import { cli, encodeTest, resetState } from "../../src/lib/state";
import type { CliState, TrackInfo } from "../../src/lib/types";

/** A 640×480 H.264 track at 30 fps. */
export const VIDEO_TRACK: TrackInfo = {
  kind: "video",
  codec: "avc",
  codecString: "avc1.640020",
  codecInfo: null,
  packetRate: 30,
  bitrate: 500_000,
  codedWidth: 640,
  codedHeight: 480,
};

/** The command builder as it starts up. */
export const BASE_CLI: CliState = {
  quality: "medium",
  crf: 25,
  preset: "superfast",
  keyframeInterval: 1,
  gopOverride: null,
  noBFrames: true,
  pad: true,
  faststart: false,
  audioMode: "copy",
  fps: null,
  scale: 1,
  scaler: "lanczos",
};

/** resetState(), plus the command-builder fields the tab tests edit. */
export function resetCliDefaults(): void {
  resetState();
  // The CLI settings deliberately survive resetState (they are the user's, not the file's), so the
  // ones the tab tests edit are put back by hand rather than leaking into the tests after them.
  cli.quality = "medium";
  cli.crf = 25;
  cli.preset = "superfast";
  cli.scale = 1;
  cli.scaler = "lanczos";
  encodeTest.segments = 5;
}
