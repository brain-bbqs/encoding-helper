import { describe, expect, it } from "vitest";
import {
  buildAnalysisDocument,
  htmlToPlainText,
  renderSectionsToHtml,
  renderSectionsToMarkdown,
  slugify,
  type DocumentMeta,
} from "../../src/lib/analysisDoc";
import type { AnalysisSection } from "../../src/lib/types";

const META: DocumentMeta = {
  fileName: "sub-01_ses-reference_video.mp4",
  generated: "1 Jan 2026, 09:00",
  version: "1.2.3",
  appUrl: "https://encoding-helper.example",
  facts: [
    ["Container", "MP4"],
    ["Duration", "30.0 s"],
  ],
};

function chart(): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "bitrate-chart");
  return svg;
}

const SECTIONS: AnalysisSection[] = [
  {
    title: "Video Container Overview",
    blocks: [
      { kind: "prose", html: "<b>MP4</b> is a container.<p>The codec is the compression.</p>" },
      {
        kind: "kv",
        items: [
          ["Type", "MP4"],
          ["Duration", "30.0 s"],
        ],
      },
      { kind: "badge", tone: "good", text: "Faststart" },
    ],
  },
  {
    title: "GOP / Keyframe Structure",
    blocks: [
      { kind: "figure", caption: "GOP length per interval", element: chart() },
      { kind: "code", lang: "bash", content: "ffmpeg -i in.mp4 out.mp4" },
      { kind: "table", headers: ["t", "Decode"], rows: [["0.5s", "12 ms"]] },
    ],
  },
];

describe("slugify", () => {
  it("makes a section title into an anchor id", () => {
    expect(slugify("GOP / Keyframe Structure")).toBe("gop-keyframe-structure");
    expect(slugify("This File's Container: MP4")).toBe("this-file-s-container-mp4");
  });

  it("falls back rather than emitting an empty id", () => {
    expect(slugify("—")).toBe("section");
  });
});

describe("htmlToPlainText", () => {
  it("keeps the block structure explainer markup carries", () => {
    expect(htmlToPlainText("<b>One.</b><p>Two.</p><ul><li>a</li><li>b</li></ul>")).toBe("One.\nTwo.\n\n- a\n- b");
  });

  it("decodes entities instead of passing them through", () => {
    expect(htmlToPlainText("bits &times; 8 &divide; duration")).toBe("bits × 8 ÷ duration");
  });
});

describe("renderSectionsToHtml", () => {
  it("anchors every section by its slug so the contents list can reach it", () => {
    const holder = document.createElement("div");
    holder.append(renderSectionsToHtml(SECTIONS));
    expect(Array.from(holder.querySelectorAll("section")).map((s) => s.id)).toEqual([
      "video-container-overview",
      "gop-keyframe-structure",
    ]);
    expect(holder.querySelector("section h2")?.textContent).toBe("Video Container Overview");
  });

  it("draws each block kind as the app's own markup", () => {
    const holder = document.createElement("div");
    holder.append(renderSectionsToHtml(SECTIONS));
    expect(holder.querySelector(".teach")?.innerHTML).toContain("<b>MP4</b>");
    expect(holder.querySelectorAll(".grid .item").length).toBe(2);
    expect(holder.querySelector(".badge")?.className).toBe("badge good");
    expect(holder.querySelector("pre.cmd")?.textContent).toBe("ffmpeg -i in.mp4 out.mp4");
    expect(holder.querySelectorAll("table.data tbody tr").length).toBe(1);
    expect(holder.querySelector(".fig figcaption")?.textContent).toBe("GOP length per interval");
  });

  it("clones figures, so rendering the same sections twice draws the chart both times", () => {
    const first = document.createElement("div");
    first.append(renderSectionsToHtml(SECTIONS));
    const second = document.createElement("div");
    second.append(renderSectionsToHtml(SECTIONS));
    expect(first.querySelectorAll("svg.bitrate-chart").length).toBe(1);
    expect(second.querySelectorAll("svg.bitrate-chart").length).toBe(1);
  });
});

describe("buildAnalysisDocument", () => {
  const html = buildAnalysisDocument(SECTIONS, META);

  it("is a self-contained page: no external stylesheet, script or asset", () => {
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<style>");
    expect(/<link\b/.test(html)).toBe(false);
    expect(/<script\b/.test(html)).toBe(false);
    expect(/\b(src|href)="https?:\/\/(?!encoding-helper\.example)/.test(html)).toBe(false);
  });

  it("titles itself after the analyzed file and stamps how it was made", () => {
    expect(html).toContain("<title>Encoding Helper analysis: sub-01_ses-reference_video.mp4</title>");
    expect(html).toContain("1 Jan 2026, 09:00");
    expect(html).toContain("v1.2.3");
  });

  it("lists every section in the contents, linked to its anchor", () => {
    expect(html).toContain('<a href="#video-container-overview">Video Container Overview</a>');
    expect(html).toContain('<a href="#gop-keyframe-structure">GOP / Keyframe Structure</a>');
  });

  it("escapes a file name that would otherwise close a tag", () => {
    const nasty = buildAnalysisDocument([], { ...META, fileName: '<img src=x onerror="alert(1)">.mp4' });
    expect(nasty).not.toContain("<img src=x");
    expect(nasty).toContain("&lt;img src=x");
  });
});

describe("renderSectionsToMarkdown", () => {
  const md = renderSectionsToMarkdown(SECTIONS, META);

  it("heads the document with the file and how it was made", () => {
    expect(md.startsWith("# Encoding Helper analysis: sub-01_ses-reference_video.mp4")).toBe(true);
    expect(md).toContain("**Container:** MP4");
  });

  it("writes each block kind out as Markdown", () => {
    expect(md).toContain("## Video Container Overview");
    expect(md).toContain("| Type | MP4 |");
    expect(md).toContain("**Faststart**");
    expect(md).toContain("```bash\nffmpeg -i in.mp4 out.mp4\n```");
    expect(md).toContain("| 0.5s | 12 ms |");
    expect(md).toContain("The codec is the compression.");
  });

  it("names a chart it cannot carry rather than dropping it silently", () => {
    expect(md).toContain("_Chart: GOP length per interval");
  });

  it("escapes a pipe in a value instead of splitting the row", () => {
    const piped = renderSectionsToMarkdown(
      [{ title: "Tags", blocks: [{ kind: "kv", items: [["©too", "Lavf|61"]] }] }],
      META,
    );
    expect(piped).toContain("| ©too | Lavf\\|61 |");
  });
});
