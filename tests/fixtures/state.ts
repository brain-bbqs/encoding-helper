// Fixtures the unit tests share for the app's state: the video track most tabs are rendered over,
// the command builder's defaults, and the reset that puts both back between tests.

import { cli, resetState } from "../../src/lib/state";
import type { CliState, TrackInfo } from "../../src/lib/types";

/** A 640×480 H.264 track at 30 fps, shown at the size it is coded at. */
export const VIDEO_TRACK: TrackInfo = {
  kind: "video",
  codec: "avc",
  codecString: "avc1.640020",
  codecInfo: null,
  packetRate: 30,
  bitrate: 500_000,
  codedWidth: 640,
  codedHeight: 480,
  displayWidth: 640,
  displayHeight: 480,
};

/** The command builder as it starts up: a copy of the app's own `cli`, taken when this module loads
 * and before any test has edited it, so there is no second list of defaults to fall out of step. */
export const BASE_CLI: CliState = structuredClone(cli);

/** resetState(), plus every command-builder field put back to its default. */
export function resetCliDefaults(): void {
  resetState();
  // The CLI settings deliberately survive resetState (they are the user's, not the file's), so all
  // of them are put back from BASE_CLI rather than leaking into the tests after the one that edited them.
  Object.assign(cli, BASE_CLI);
}
