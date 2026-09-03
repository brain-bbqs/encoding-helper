// Formatting helpers for bytes, durations, bitrates, sample rates, milliseconds, and the handful of
// facts the Inspect tab and the Full Analysis document both print.

export function fmtBytes(b: number | null | undefined): string {
  if (b == null) return "–";
  if (b < 1024) return b + " B";
  if (b < 1048576) return (b / 1024).toFixed(1) + " KB";
  if (b < 1073741824) return (b / 1048576).toFixed(1) + " MB";
  return (b / 1073741824).toFixed(2) + " GB";
}

export function fmtDur(s: number | null | undefined): string {
  if (s == null) return "–";
  if (s < 60) return s.toFixed(3) + " s";
  if (s < 3600) return Math.floor(s / 60) + "m " + (s % 60).toFixed(1) + "s";
  return Math.floor(s / 3600) + "h " + Math.floor((s % 3600) / 60) + "m " + Math.round(s % 60) + "s";
}

export function fmtBits(bps: number | null | undefined): string {
  if (bps == null || !isFinite(bps)) return "–";
  if (bps < 1e3) return Math.round(bps) + " bps";
  if (bps < 1e6) return (bps / 1e3).toFixed(0) + " kbps";
  return (bps / 1e6).toFixed(2) + " Mbps";
}

export function fmtRate(hz: number | null | undefined): string {
  return hz == null ? "–" : hz % 1 < 0.005 ? Math.round(hz).toString() : hz.toFixed(3);
}

export function fmtMs(ms: number | null | undefined): string {
  return ms == null ? "–" : ms.toFixed(1) + " ms";
}

/** The message of whatever was thrown: an Error's own, or the value itself as text. */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** How much smaller (or larger) an encode came out, as a signed percentage: "-42.0%" for a saving. */
export function fmtSizeChangePct(originalSize: number, encodedSize: number): string {
  const pct = (1 - encodedSize / originalSize) * 100;
  return (pct >= 0 ? "-" : "+") + Math.abs(pct).toFixed(1) + "%";
}

/** A track's colour space as "primaries / transfer / matrix", or "–" when the file states none of them. */
export function describeColorSpace(cs: VideoColorSpaceInit): string {
  return [cs.primaries, cs.transfer, cs.matrix].filter(Boolean).join(" / ") || "–";
}

export function describeFrameRate(packetRate: number | null | undefined): string {
  return packetRate != null ? fmtRate(packetRate) + " fps" : "–";
}

export function describeFrameCount(count: number | null): string {
  return count != null ? count.toLocaleString() : "–";
}
