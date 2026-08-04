// Formatting helpers for bytes, durations, bitrates, sample rates, and milliseconds.

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
