// The Low-Bandwidth Playback card, on Inspect directly after the bitrate plot: whether this file
// would play through over a link of a given speed, and what it would cost the viewer if not.
//
// It follows the bitrate card because it is the same measurement asked as a question — the plot
// above shows where the bits went, this says who can afford them — and it is the one card here that
// needs no run: lib/playbackSim works the whole of playback out of the sample table, so the answer
// changes as the link speed does rather than behind a button.

import { fold, gridItem, h, teachBox } from "../lib/dom";
import {
  DOWNLOAD_TIME_INFO,
  LINK_SPEED_INFO,
  LOW_BANDWIDTH_TEACH,
  MOOV_LAST_PLAYBACK_NOTE,
  REQUIRED_BITRATE_INFO,
  REQUIRED_STARTUP_INFO,
  STARTUP_WAIT_INFO,
} from "../lib/explainers";
import { fmtBits } from "../lib/format";
import { simulatePlayback, type PlaybackSimulation } from "../lib/playbackSim";
import { bandwidth, state } from "../lib/state";
import { renderBufferChart } from "./bufferChart";
import { fieldNumber, fieldSelect } from "./formControls";

/** Caption for the buffer plot, shared with the Full Analysis document. */
export const BUFFER_CHART_CAPTION =
  "Seconds of video buffered ahead of the playhead through playback; stalls are marked on the baseline";

/**
 * The link speeds offered, labelled by where a viewer meets them rather than only by their number,
 * since the number on a connection's plan is not the throughput it delivers. Deliberately weighted
 * toward the slow end: a file that survives 25 Mbps was never the question.
 */
export const LINK_PRESETS: [label: string, bps: number][] = [
  ["Congested public wifi — 0.5 Mbps", 500_000],
  ["3G or a weak cell signal — 1.5 Mbps", 1_500_000],
  ["Busy conference or hotel wifi — 3 Mbps", 3_000_000],
  ["Basic home broadband — 5 Mbps", 5_000_000],
  ["Healthy wifi — 10 Mbps", 10_000_000],
  ["Fast broadband — 25 Mbps", 25_000_000],
];

/** Wall-clock spans, at the precision each is worth reading to rather than to the millisecond. */
export function fmtWait(sec: number | null | undefined): string {
  if (sec == null || !isFinite(sec)) return "–";
  if (sec < 10) return sec.toFixed(1) + " s";
  if (sec < 60) return Math.round(sec) + " s";
  const mins = Math.floor(sec / 60);
  if (mins < 60) return `${mins}m ${Math.round(sec % 60)}s`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

/**
 * Bytes that must land before the first frame can be shown. For a faststart file that is the header
 * ahead of the media data, a few KB; for one whose `moov` index sits at the end it is the whole
 * file, since a player has nothing to decode with until the last byte is down.
 */
function preloadBytesFor(fileBytes: number): number {
  if (state.faststart === false) return fileBytes;
  const mdat = state.boxes.find((b) => b.type === "mdat");
  return mdat ? mdat.start : 0;
}

/** Runs the simulation for whatever the card's controls currently say. Null with nothing to run on. */
export function currentPlaybackSim(): PlaybackSimulation | null {
  const fileBytes = state.source?.size;
  return simulatePlayback(state.samples, state.duration ?? 0, {
    linkBitrateBps: bandwidth.linkBitrateBps,
    startupSec: bandwidth.startupSec,
    fileBytes,
    preloadBytes: fileBytes != null ? preloadBytesFor(fileBytes) : 0,
  });
}

/** The verdict line: what a viewer on this link would actually experience, in one sentence. */
export function playbackVerdict(sim: PlaybackSimulation): { text: string; tone: "good" | "bad" | "info" } {
  if (state.faststart === false) {
    return {
      text: `Nothing plays for ${fmtWait(sim.downloadSec)}, then it plays through`,
      tone: "info",
    };
  }
  if (sim.smooth) return { text: "✓ Plays through without stalling", tone: "good" };
  const n = sim.stalls.length;
  return { text: `✗ Stalls ${n} time${n === 1 ? "" : "s"}, ${fmtWait(sim.stalledSec)} frozen in total`, tone: "bad" };
}

/** The figures a run produces, in the order the reader needs them. */
export function playbackSummaryItems(sim: PlaybackSimulation): [string, string][] {
  return [
    ["Needs At Least", fmtBits(sim.requiredBitrateBps)],
    ["Startup Wait Needed", fmtWait(sim.requiredStartupSec)],
    ["Stalls", String(sim.stalls.length)],
    ["Time Stalled", fmtWait(sim.stalledSec)],
    ["Whole-File Download", `${fmtWait(sim.downloadSec)} (${sim.realtimeRatio.toFixed(2)}× real time)`],
  ];
}

function renderResults(wrap: HTMLDivElement): void {
  wrap.innerHTML = "";
  const sim = currentPlaybackSim();
  if (!sim) {
    wrap.append(h("div", "progress-label", "Not enough of a sample table here to play the file back."));
    return;
  }

  const verdict = playbackVerdict(sim);
  const badgeWrap = h("div");
  badgeWrap.style.margin = "4px 0 12px";
  badgeWrap.append(h("span", "badge " + verdict.tone, verdict.text));
  wrap.append(badgeWrap);

  const [needs, startup, stalls, stalled, download] = playbackSummaryItems(sim);
  const g = h("div", "grid");
  g.append(
    gridItem(needs[0], needs[1], { info: REQUIRED_BITRATE_INFO }),
    gridItem(startup[0], startup[1], { info: REQUIRED_STARTUP_INFO }),
    gridItem(stalls[0], stalls[1]),
    gridItem(stalled[0], stalled[1]),
    gridItem(download[0], download[1], { wide: true, info: DOWNLOAD_TIME_INFO }),
  );
  wrap.append(g);

  const chart = renderBufferChart(sim, state.duration ?? 0);
  if (chart) {
    wrap.append(chart);
    wrap.append(h("div", "progress-label", BUFFER_CHART_CAPTION));
  }

  // Where every freeze lands is detail behind the count rather than in front of it, so it folds
  // away like the seeking test's sampled timestamps.
  if (sim.stalls.length) {
    const { wrap: stallFold, body } = fold(
      "Where playback freezes",
      `${sim.stalls.length} stall${sim.stalls.length === 1 ? "" : "s"}`,
    );
    const scroll = h("div", "scroll-x");
    const table = h("table", "data");
    const thead = h("thead");
    const headRow = h("tr");
    ["Playback Position", "Frozen For"].forEach((t) => headRow.append(h("th", null, t)));
    thead.append(headRow);
    table.append(thead);
    const tbody = h("tbody");
    sim.stalls.forEach((s) => {
      const tr = h("tr");
      tr.append(h("td", null, s.atMediaSec.toFixed(2) + "s"), h("td", null, fmtWait(s.seconds)));
      tbody.append(tr);
    });
    table.append(tbody);
    scroll.append(table);
    body.append(scroll);
    wrap.append(stallFold);
  }
}

/**
 * Null where there is nothing to simulate — no frames, or no duration to play them over — rather
 * than a card whose controls change nothing.
 */
export function renderBandwidthSection(): HTMLDivElement | null {
  if (!state.samples.length || !((state.duration ?? 0) > 0)) return null;

  const sec = h("div", "section");
  sec.append(h("h2", null, "Low-Bandwidth Playback"));
  sec.append(teachBox(LOW_BANDWIDTH_TEACH));
  if (state.faststart === false) sec.append(teachBox(MOOV_LAST_PLAYBACK_NOTE));

  const isPreset = LINK_PRESETS.some(([, bps]) => bps === bandwidth.linkBitrateBps);
  const controls = h("div", "row");
  const linkField = fieldSelect(
    "bwLinkSpeed",
    "Link Speed",
    [...LINK_PRESETS.map(([label, bps]): [string, string] => [String(bps), label]), ["custom", "Custom…"]],
    isPreset ? String(bandwidth.linkBitrateBps) : "custom",
    LINK_SPEED_INFO,
  );
  const customField = fieldNumber(
    "bwCustomSpeed",
    "Custom Speed (Mbps)",
    (bandwidth.linkBitrateBps / 1e6).toFixed(2),
    0.05,
    1000,
    0.05,
  );
  customField.style.display = isPreset ? "none" : "";
  const startupField = fieldNumber(
    "bwStartup",
    "Startup Wait (s)",
    bandwidth.startupSec,
    0,
    60,
    0.5,
    STARTUP_WAIT_INFO,
  );
  controls.append(linkField, customField, startupField);
  sec.append(controls);

  const results = h("div");
  sec.append(results);
  renderResults(results);

  const linkSelect = linkField.querySelector("select");
  const customInput = customField.querySelector("input");
  const startupInput = startupField.querySelector("input");

  linkSelect?.addEventListener("change", () => {
    const chosen = linkSelect.value;
    customField.style.display = chosen === "custom" ? "" : "none";
    if (chosen === "custom") {
      // Carries the speed the reader was just looking at into the box, so switching to Custom is a
      // starting point to nudge rather than a blank field.
      if (customInput) customInput.value = (bandwidth.linkBitrateBps / 1e6).toFixed(2);
    } else {
      bandwidth.linkBitrateBps = Number(chosen);
    }
    renderResults(results);
  });
  customInput?.addEventListener("input", () => {
    const mbps = Number(customInput.value);
    if (!(mbps > 0)) return;
    bandwidth.linkBitrateBps = mbps * 1e6;
    renderResults(results);
  });
  startupInput?.addEventListener("input", () => {
    const secs = Number(startupInput.value);
    if (!(secs >= 0)) return;
    bandwidth.startupSec = secs;
    renderResults(results);
  });

  return sec;
}
