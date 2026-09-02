// The track that picks which few seconds of the file a single run encodes.
//
// The maths behind brain-bbqs/clip-extractor's trim timeline, in seconds rather than frames: this
// app never needs to land on an exact frame, since the stretch it cuts starts at a keyframe anyway.
// The ruler is the same idea — a step someone reads at a glance, about six labelled divisions across
// whatever the recording runs — so the two apps' timelines are gradated the same way.

/** How long the stretch a single run encodes is, in seconds.
 *
 * Fixed rather than asked for: this run answers "what does this setting look like", and three
 * seconds is enough of a moving picture to judge that on while being quick enough to sit through at
 * in-browser speed. Which three seconds is the question worth asking, and the track asks it. */
export const SAMPLE_SECONDS = 3;

// Gradations the ruler is allowed to divide a recording into, in seconds — clip-extractor's list.
// Every one of them is a step read at a glance; 3s or 7s marks would be arithmetic instead.
const RULER_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 10800, 21600, 43200];

/** The gradation a recording of `seconds` is divided by: the step landing nearest six labelled
 * divisions, and the fifth of it the minor ticks sit on. */
export function rulerStep(seconds: number): { major: number; minor: number } {
  const major = RULER_STEPS.find((step) => step >= seconds / 6) ?? RULER_STEPS[RULER_STEPS.length - 1];
  return { major, minor: major / 5 };
}

/** One gradation on the track's ruler. */
interface RulerMark {
  seconds: number;
  /** Drawn taller and labelled; the minor marks between are unlabelled. */
  major: boolean;
}

/** The gradations across a recording, at the step {@link rulerStep} picks for its length. */
export function rulerMarks(totalSeconds: number): RulerMark[] {
  if (!(totalSeconds > 0)) return [];
  const { major, minor } = rulerStep(totalSeconds);
  const marks: RulerMark[] = [];
  for (let step = 0; step * minor <= totalSeconds + 1e-9; step++) {
    const seconds = step * minor;
    marks.push({ seconds, major: Math.abs(seconds % major) < 1e-9 });
  }
  return marks;
}

/**
 * A window start held inside the recording.
 *
 * The window keeps its length at either end rather than being trimmed to fit, so the stretch that
 * is encoded is the stretch the track drew — and a recording shorter than the window is covered
 * whole, from zero.
 */
export function clampWindowStart(start: number, totalSeconds: number, windowSeconds: number): number {
  const last = Math.max(0, totalSeconds - windowSeconds);
  if (!Number.isFinite(start)) return 0;
  return Math.min(Math.max(0, start), last);
}

/** A gradation's time as `m:ss`, or `h:mm:ss` once a recording is long enough to need the hours. */
export function fmtClock(seconds: number, totalSeconds = seconds): string {
  const whole = Math.max(0, Math.round(seconds));
  const mm = Math.floor(whole / 60) % 60;
  const ss = whole % 60;
  if (totalSeconds < 3600) return `${Math.floor(whole / 60)}:${String(ss).padStart(2, "0")}`;
  return `${Math.floor(whole / 3600)}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}
