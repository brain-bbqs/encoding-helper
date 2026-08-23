// The video the integration tests load, built on the spot rather than committed.
//
// The app no longer ships a sample file: the demo set lives on the EMBER archive (see
// src/lib/demoArchive.ts), and a video blob committed here to stand in for it would sit in the git
// history forever, which is the thing the move to the archive was for. So the tests mock the
// archive (tests/integration/demoArchive.ts) and serve these bytes, generated once per checkout by
// the Playwright global setup and kept out of git.
//
// It is deliberately shaped like the reference demo: thirty seconds, a three-second GOP, a CRF
// encode (so the bitrate plot has a shape rather than a flat line), AAC audio, and faststart.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const FIXTURE_DIR = join(fileURLToPath(new URL(".", import.meta.url)), ".generated");

export const FIXTURE_PATH = join(FIXTURE_DIR, "demo-reference.mp4");

/** The fixture's length, which the bitrate plot's one-window-per-second binning is read against. */
export const FIXTURE_SECONDS = 30;

const FIXTURE_FPS = 30;

/**
 * Builds the fixture if it is not already there, and returns its path.
 *
 * ffmpeg is taken from FFMPEG_PATH or the PATH. It is a hard requirement rather than a skip: a
 * silently skipped suite is worse than a loud missing dependency, and this repository already needs
 * ffmpeg to generate the demo set it is standing in for.
 */
export function buildFixtureVideo(): string {
  if (existsSync(FIXTURE_PATH)) return FIXTURE_PATH;
  mkdirSync(FIXTURE_DIR, { recursive: true });
  const ffmpeg = process.env.FFMPEG_PATH ?? "ffmpeg";
  try {
    execFileSync(
      ffmpeg,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-f",
        "lavfi",
        "-i",
        `testsrc2=size=320x240:rate=${FIXTURE_FPS}:duration=${FIXTURE_SECONDS}`,
        "-f",
        "lavfi",
        "-i",
        `sine=frequency=440:duration=${FIXTURE_SECONDS}`,
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "23",
        "-pix_fmt",
        "yuv420p",
        "-g",
        String(FIXTURE_FPS * 3),
        "-c:a",
        "aac",
        "-b:a",
        "64k",
        "-movflags",
        "+faststart",
        FIXTURE_PATH,
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
  } catch (err) {
    throw new Error(
      `Could not build the test video with "${ffmpeg}". The integration tests need ffmpeg on the ` +
        `PATH, or FFMPEG_PATH pointing at one.\n${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return FIXTURE_PATH;
}
