// Tab: Report / Export.
//
// Everything is gathered once into a plain, renderer-agnostic list of sections;
// renderReportSectionsToHtml/ToMarkdown are the only two places that know how a section actually
// gets drawn, so the on-screen preview, the print/PDF view, and the .md export can never drift apart.

import { buildFfmpegArgs, CRF_MAP, formatCliCommand } from "../lib/cliCommand";
import { copyToClipboard, gridItem, h, teachBox } from "../lib/dom";
import { fmtBits, fmtBytes, fmtDur, fmtMs, fmtRate } from "../lib/format";
import { downloadBlob } from "../lib/save";
import { cli, currentVideoInfo, encodeTest, state } from "../lib/state";
import type { ReportSection, TrackInfo } from "../lib/types";
import { flattenMetadataTags } from "./inspectTab";

function stripHtml(html: string): string {
  const d = document.createElement("div");
  d.innerHTML = html;
  return d.textContent.trim();
}

function buildOverviewSection(): ReportSection {
  const fileBitrate = state.duration && state.source ? (state.source.size * 8) / state.duration : null;
  return {
    title: "Overview",
    kind: "kv",
    items: [
      ["Format", state.format || "–"],
      ["File Size", fmtBytes(state.source?.size)],
      ["Duration", fmtDur(state.duration)],
      ["Overall Bitrate", fmtBits(fileBitrate)],
      ["MIME Type", state.mimeType || "–"],
      ["Faststart", state.faststart ? "Yes (moov before mdat)" : "No (moov after mdat)"],
    ],
  };
}

function buildVideoTrackSection(vt: TrackInfo): ReportSection {
  const items: [string, string | number][] = [
    ["Codec", vt.codecString || vt.codec],
    ["Resolution", `${vt.codedWidth ?? "?"}×${vt.codedHeight ?? "?"}`],
  ];
  if (vt.displayWidth !== vt.codedWidth || vt.displayHeight !== vt.codedHeight) {
    items.push(["Display Size", `${vt.displayWidth ?? "?"}×${vt.displayHeight ?? "?"}`]);
  }
  items.push(
    ["Frame Rate", vt.packetRate != null ? fmtRate(vt.packetRate) + " fps" : "–"],
    ["Frames", state.frameCount != null ? state.frameCount.toLocaleString() : "–"],
    ["Bitrate", fmtBits(vt.bitrate)],
  );
  if (vt.rotation) items.push(["Rotation", vt.rotation + "°"]);
  if (vt.codecInfo) vt.codecInfo.details.forEach((d) => items.push([d.label, d.value]));
  if (vt.colorSpace) {
    items.push([
      "Color Space",
      [vt.colorSpace.primaries, vt.colorSpace.transfer, vt.colorSpace.matrix].filter(Boolean).join(" / ") || "–",
    ]);
  }
  if (vt.hdr) items.push(["HDR", "Yes"]);
  return {
    title: "Video Track",
    kind: "kv",
    items,
    note: vt.codecInfo
      ? `${vt.codecInfo.family}${vt.codecInfo.year ? " (" + vt.codecInfo.year + ")" : ""}: ${stripHtml(vt.codecInfo.description)}`
      : null,
  };
}

function buildAudioTrackSection(at: TrackInfo): ReportSection {
  const items: [string, string | number][] = [
    ["Codec", at.codecString || at.codec],
    ["Sample Rate", at.sampleRate ? at.sampleRate.toLocaleString() + " Hz" : "–"],
    ["Channels", at.channels != null ? at.channels : "–"],
    ["Bitrate", fmtBits(at.bitrate)],
  ];
  if (at.codecInfo) at.codecInfo.details.forEach((d) => items.push([d.label, d.value]));
  return {
    title: "Audio Track",
    kind: "kv",
    items,
    note: at.codecInfo
      ? `${at.codecInfo.family}${at.codecInfo.year ? " (" + at.codecInfo.year + ")" : ""}: ${stripHtml(at.codecInfo.description)}`
      : null,
  };
}

function buildAtomMapSection(): ReportSection | null {
  if (!state.boxes.length) return null;
  const lines: string[] = [];
  const walk = (box: (typeof state.boxes)[number], depth: number): void => {
    lines.push(
      `${"  ".repeat(depth)}${box.type.padEnd(6)} offset ${box.start.toLocaleString()}  ${fmtBytes(box.size)} (${box.size.toLocaleString()} B)`,
    );
    box.children.forEach((c) => walk(c, depth + 1));
  };
  state.boxes.forEach((b) => walk(b, 0));
  return { title: "MP4 Atom Map", kind: "code", lang: "", content: lines.join("\n") };
}

function buildGopSection(): ReportSection | null {
  if (!state.samples.length) return null;
  const gop = state.gopLengths;
  const avgGop = gop.length ? gop.reduce((a, b) => a + b, 0) / gop.length : 0;
  const fps = state.fps || 30;
  return {
    title: "GOP / Keyframe Structure",
    kind: "kv",
    items: [
      ["Total Frames", state.samples.length.toLocaleString()],
      ["Keyframes", state.keyframeDecodeIndices.length.toLocaleString()],
      ["Avg GOP", `${avgGop.toFixed(1)} frames (${(avgGop / fps).toFixed(2)} s)`],
      ["Min/Max GOP", gop.length ? `${Math.min(...gop)} / ${Math.max(...gop)} frames` : "–"],
      ["B-Frames", state.hasBFrames ? "Yes (cts ≠ dts)" : "No (IPPP…)"],
    ],
  };
}

function buildSeekingSection(): ReportSection | null {
  if (!state.seekResults || !state.seekResults.length) return null;
  const results = state.seekResults;
  const avgDist = results.reduce((a, r) => a + (r.dist || 0), 0) / results.length;
  const avgDecode = results.reduce((a, r) => a + r.decodeMs, 0) / results.length;
  const maxDecode = Math.max(...results.map((r) => r.decodeMs));
  return {
    title: "Empirical Seeking Test",
    kind: "table",
    summary: [
      ["Avg Keyframe Distance", avgDist.toFixed(3) + " s"],
      ["Avg Decode Time", fmtMs(avgDecode)],
      ["Max Decode Time", fmtMs(maxDecode)],
    ],
    headers: ["Timestamp", "Nearest Keyframe ≤ t", "Distance", "Distance (frames)", "Decode Time"],
    rows: results.map((r) => [
      r.t.toFixed(3) + "s",
      r.kf != null ? r.kf.toFixed(3) + "s" : "—",
      r.dist != null ? r.dist.toFixed(3) + "s" : "—",
      r.distFrames != null ? String(r.distFrames) : "—",
      fmtMs(r.decodeMs),
    ]),
  };
}

function buildCliCommandSection(): ReportSection | null {
  const info = currentVideoInfo();
  if (!info) return null;
  const args = buildFfmpegArgs(cli, info);
  return { title: "Re-encode CLI Command", kind: "code", lang: "bash", content: formatCliCommand(args) };
}

function buildEncodeTestSection(): ReportSection | null {
  if (!encodeTest.originalSink || !encodeTest.encodedSink) return null;
  return {
    title: "Encode Test (A/B) Result",
    kind: "kv",
    items: [
      ["Segment", `${encodeTest.startTime.toFixed(1)}s–${(encodeTest.startTime + encodeTest.duration).toFixed(1)}s`],
      [
        "Quality",
        cli.quality === "custom" ? `Custom (CRF ${cli.crf})` : `${cli.quality} (CRF ${CRF_MAP[cli.quality]})`,
      ],
      ["Preset", cli.preset],
      ["Encoded Segment Size", fmtBytes(encodeTest.encodedSize)],
    ],
  };
}

function buildReportSections(): ReportSection[] {
  if (!state.source) return [];
  const vt = state.tracks?.find((t) => t.kind === "video");
  const at = state.tracks?.find((t) => t.kind === "audio");
  const flatTags = flattenMetadataTags();

  const sections: (ReportSection | null)[] = [
    buildOverviewSection(),
    vt ? buildVideoTrackSection(vt) : null,
    at ? buildAudioTrackSection(at) : null,
    Object.keys(flatTags).length
      ? {
          title: "Metadata Tags",
          kind: "kv",
          items: Object.entries(flatTags).map(([k, v]): [string, string] => [k, String(v)]),
        }
      : null,
    buildAtomMapSection(),
    buildGopSection(),
    buildSeekingSection(),
    vt ? buildCliCommandSection() : null,
    buildEncodeTestSection(),
  ];
  return sections.filter((s): s is ReportSection => s !== null);
}

function renderReportSectionsToHtml(sections: ReportSection[]): DocumentFragment {
  const frag = document.createDocumentFragment();
  sections.forEach((sec) => {
    const secEl = h("div", "section");
    secEl.append(h("h2", null, sec.title));
    if (sec.kind === "kv") {
      const g = h("div", "grid");
      sec.items.forEach(([k, v]) => g.append(gridItem(k, v, { sm: String(v).length > 18 })));
      secEl.append(g);
      if (sec.note) secEl.append(h("div", "teach", sec.note));
    } else if (sec.kind === "code") {
      secEl.append(h("pre", "cmd", sec.content));
    } else {
      if (sec.summary) {
        const g = h("div", "grid");
        sec.summary.forEach(([k, v]) => g.append(gridItem(k, v)));
        secEl.append(g);
      }
      const scroll = h("div", "scroll-x");
      const table = h("table", "data");
      const thead = h("thead");
      const headRow = h("tr");
      sec.headers.forEach((hd) => headRow.append(h("th", null, hd)));
      thead.append(headRow);
      table.append(thead);
      const tbody = h("tbody");
      sec.rows.forEach((row) => {
        const tr = h("tr");
        row.forEach((cell) => tr.append(h("td", null, cell)));
        tbody.append(tr);
      });
      table.append(tbody);
      scroll.append(table);
      secEl.append(scroll);
    }
    frag.append(secEl);
  });
  return frag;
}

function renderReportSectionsToMarkdown(sections: ReportSection[], title: string): string {
  const esc = (s: string | number): string =>
    String(s)
      .replace(/\\/g, "\\\\")
      .replace(/\|/g, "\\|");
  const lines = [
    `# Encoding Helper Report — ${title}`,
    "",
    `_Generated ${new Date().toLocaleString()} · https://vibes.tlab.sh/encoding-helper/_`,
    "",
  ];
  sections.forEach((sec) => {
    lines.push(`## ${sec.title}`, "");
    if (sec.kind === "kv") {
      lines.push("| Field | Value |", "|---|---|");
      sec.items.forEach(([k, v]) => lines.push(`| ${esc(k)} | ${esc(v)} |`));
      lines.push("");
      if (sec.note) lines.push("> " + sec.note.replace(/\n/g, "\n> "), "");
    } else if (sec.kind === "code") {
      lines.push("```" + sec.lang, sec.content, "```", "");
    } else {
      if (sec.summary) {
        lines.push("| Metric | Value |", "|---|---|");
        sec.summary.forEach(([k, v]) => lines.push(`| ${esc(k)} | ${esc(v)} |`));
        lines.push("");
      }
      lines.push("| " + sec.headers.join(" | ") + " |", "|" + sec.headers.map(() => "---").join("|") + "|");
      sec.rows.forEach((row) => lines.push("| " + row.map(esc).join(" | ") + " |"));
      lines.push("");
    }
  });
  return lines.join("\n");
}

export function renderReportTab(panel: HTMLElement, printArea: HTMLElement): void {
  panel.innerHTML = "";
  if (!state.source) return;

  const sec = h("div", "section");
  sec.append(h("h2", null, "Report / Export"));
  sec.append(
    teachBox(
      `Compiles everything above &mdash; metadata, the codec explainer, the atom map, GOP/keyframe stats, the ` +
        `seeking test and Encode Test results (if you've run them), and the CLI command &mdash; into one ` +
        `shareable report.`,
    ),
  );
  const actions = h("div", "load-actions");
  const copyBtn = h("button", "btn", "Copy Markdown");
  copyBtn.type = "button";
  const dlBtn = h("button", "btn sec", "Download .md");
  dlBtn.type = "button";
  const printBtn = h("button", "btn sec", "Print / Save as PDF");
  printBtn.type = "button";
  actions.append(copyBtn, dlBtn, printBtn);
  sec.append(actions);
  panel.append(sec);

  const previewWrap = h("div");
  panel.append(previewWrap);

  const refresh = (): ReportSection[] => {
    const sections = buildReportSections();
    previewWrap.innerHTML = "";
    previewWrap.append(renderReportSectionsToHtml(sections));

    printArea.innerHTML = "";
    printArea.append(
      h("h1", null, `Encoding Helper Report — ${state.source?.name ?? ""}`),
      h("p", "report-meta", `Generated ${new Date().toLocaleString()} · vibes.tlab.sh/encoding-helper`),
      renderReportSectionsToHtml(sections),
    );
    return sections;
  };

  copyBtn.addEventListener("click", () => {
    const md = renderReportSectionsToMarkdown(buildReportSections(), state.source?.name ?? "video");
    copyToClipboard(md, copyBtn);
  });
  dlBtn.addEventListener("click", () => {
    const md = renderReportSectionsToMarkdown(buildReportSections(), state.source?.name ?? "video");
    const blob = new Blob([md], { type: "text/markdown" });
    downloadBlob(blob, (state.source?.name || "video").replace(/\.[^.]+$/, "") + ".report.md");
  });
  printBtn.addEventListener("click", () => {
    refresh();
    window.print();
  });

  refresh();
}
