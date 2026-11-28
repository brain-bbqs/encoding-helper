// Formatting helpers for durations, bitrates, frame rates, milliseconds, and the handful of
// facts the Inspect tab and the Full Analysis document both print. Also the placeholder dash and
// the fallback frame rate: this module imports nothing, so any file can use them without a cycle.

/** The dash shown in place of a value that is missing. */
export const NO_VALUE = "–";

/** The frame rate assumed wherever one is needed and the file does not state it. */
export const FALLBACK_FPS = 30;

// The helpers below that change unit with size pick the unit on the figure as it will print, not
// as it stands, so a field that rounds up to a whole unit carries into the next one: 119.97 s is
// "2m 0.0s" rather than "1m 60.0s", and 999,600 bps "1.00 Mbps" rather than "1000 kbps".

export function fmtDur(s: number | null | undefined): string {
  if (s == null) return NO_VALUE;
  if (Math.round(s * 1000) < 60_000) return s.toFixed(3) + " s";
  const tenths = Math.round(s * 10);
  if (tenths < 36_000) return Math.floor(tenths / 600) + "m " + ((tenths % 600) / 10).toFixed(1) + "s";
  const whole = Math.round(s);
  return Math.floor(whole / 3600) + "h " + Math.floor((whole % 3600) / 60) + "m " + (whole % 60) + "s";
}

export function fmtBits(bps: number | null | undefined): string {
  if (bps == null || !isFinite(bps)) return NO_VALUE;
  if (Math.round(bps) < 1e3) return Math.round(bps) + " bps";
  if (Math.round(bps / 1e3) < 1e3) return Math.round(bps / 1e3) + " kbps";
  return (bps / 1e6).toFixed(2) + " Mbps";
}

/**
 * A frame rate to three decimals, or whole when within 0.005 of a whole number, either side: a
 * rate measured from packet times lands a hair off its nominal one, as likely under it as over.
 */
export function fmtRate(fps: number | null | undefined): string {
  if (fps == null) return NO_VALUE;
  const whole = Math.round(fps);
  return Math.abs(fps - whole) < 0.005 ? String(whole) : fps.toFixed(3);
}

export function fmtMs(ms: number | null | undefined): string {
  return ms == null ? NO_VALUE : ms.toFixed(1) + " ms";
}

/** A track's colour space as "primaries / transfer / matrix", or "–" when the file states none of them. */
export function describeColorSpace(cs: VideoColorSpaceInit): string {
  return [cs.primaries, cs.transfer, cs.matrix].filter(Boolean).join(" / ") || NO_VALUE;
}

export function describeFrameRate(packetRate: number | null | undefined): string {
  return packetRate != null ? fmtRate(packetRate) + " fps" : NO_VALUE;
}

export function describeFrameCount(count: number): string {
  return count.toLocaleString();
}
