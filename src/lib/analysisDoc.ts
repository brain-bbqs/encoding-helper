// The Full Analysis document: how a list of AnalysisSections becomes something you can read, save
// or hand to someone else.
//
// There is one document, rendered three ways from the same sections — the preview in the panel, the
// .html file the Download button writes, and whatever the browser's print dialog turns that into —
// because the first two are literally the same string, and the third is the browser printing it.
// The Markdown export is the one separate renderer, for pasting into an issue or a lab notebook.
//
// The document is deliberately light-only. It is paper, not a page of the app: it is read after
// being saved, printed or emailed, where the reader's theme is not ours to follow, and a dark
// surface is the wrong thing to send to a printer. Its stylesheet is inlined into the exported file
// so the document keeps its look with no network and no app around it.

import { gridItem, h, teachBox } from "./dom";
import type { AnalysisBlock, AnalysisSection } from "./types";

/** Anchor id for a section heading, used by the document's contents list. */
export function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "section"
  );
}

/** Long values get the smaller monospace treatment, the same threshold the app's cards use. */
function isLongValue(value: string | number): boolean {
  return String(value).length > 18;
}

function renderBlock(block: AnalysisBlock): Element {
  switch (block.kind) {
    case "kv": {
      const grid = h("div", "grid");
      block.items.forEach(([k, v]) => grid.append(gridItem(k, v, { sm: isLongValue(v), rawLabel: block.rawLabels })));
      return grid;
    }
    case "prose":
      return teachBox(block.html);
    case "badge": {
      const wrap = h("div", "badge-row");
      wrap.append(h("span", "badge " + block.tone, block.text));
      return wrap;
    }
    case "code":
      return h("pre", "cmd", block.content);
    case "table": {
      const scroll = h("div", "scroll-x");
      const table = h("table", "data");
      const thead = h("thead");
      const headRow = h("tr");
      block.headers.forEach((hd) => headRow.append(h("th", null, hd)));
      thead.append(headRow);
      const tbody = h("tbody");
      block.rows.forEach((row) => {
        const tr = h("tr");
        row.forEach((cell) => tr.append(h("td", null, cell)));
        tbody.append(tr);
      });
      table.append(thead, tbody);
      scroll.append(table);
      return scroll;
    }
    case "figure": {
      const fig = h("figure", "fig");
      fig.append(block.element.cloneNode(true));
      fig.append(h("figcaption", null, block.caption));
      return fig;
    }
  }
}

/** The sections as document DOM: one `<section>` per section, anchored by its slug. */
export function renderSectionsToHtml(sections: AnalysisSection[]): DocumentFragment {
  const frag = document.createDocumentFragment();
  sections.forEach((sec) => {
    const el = h("section", "section");
    el.id = slugify(sec.title);
    el.append(h("h2", null, sec.title));
    sec.blocks.forEach((block) => el.append(renderBlock(block)));
    frag.append(el);
  });
  return frag;
}

/**
 * Explainer markup as something Markdown can carry: block tags become line breaks and list items
 * become bullets before the tags are dropped, so a three-paragraph explainer does not arrive as one
 * run-on line. Entities are decoded by the parse, not by a table of our own.
 */
export function htmlToPlainText(html: string): string {
  const d = document.createElement("div");
  d.innerHTML = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li(\s[^>]*)?>/gi, "\n- ")
    .replace(/<\/li>/gi, "")
    // The optional group is what keeps this off <pre>, which a code block needs left alone.
    .replace(/<\/?(p|div|ul|ol|h[1-6])(\s[^>]*)?>/gi, "\n");
  return d.textContent
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function escapeCell(value: string | number): string {
  return String(value).replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
}

function markdownBlock(block: AnalysisBlock): string[] {
  switch (block.kind) {
    case "kv":
      return [
        "| Field | Value |",
        "|---|---|",
        ...block.items.map(([k, v]) => `| ${escapeCell(k)} | ${escapeCell(v)} |`),
        "",
      ];
    case "prose":
      return [htmlToPlainText(block.html), ""];
    case "badge":
      return [`**${block.text}**`, ""];
    case "code":
      return ["```" + block.lang, block.content, "```", ""];
    case "table":
      return [
        "| " + block.headers.join(" | ") + " |",
        "|" + block.headers.map(() => "---").join("|") + "|",
        ...block.rows.map((row) => "| " + row.map(escapeCell).join(" | ") + " |"),
        "",
      ];
    case "figure":
      // Markdown has nowhere to put an SVG that survives a paste into an issue, so it names the
      // chart and points at the two renderings that do carry it.
      return [`_Chart: ${block.caption} — see the HTML or PDF version._`, ""];
  }
}

export interface DocumentMeta {
  /** The analyzed file's name, which is the document's title. */
  fileName: string;
  /** Rendered timestamp, passed in rather than read here so the renderers stay deterministic. */
  generated: string;
  /** App version stamp, e.g. "0.3.0". */
  version: string;
  /** Where the app lives, printed in the document so a saved copy says what produced it. */
  appUrl: string;
  /** Headline facts for the title block: container, codec, resolution, duration, size. */
  facts: [string, string][];
}

export function renderSectionsToMarkdown(sections: AnalysisSection[], meta: DocumentMeta): string {
  const lines = [
    `# Encoding Helper analysis: ${meta.fileName}`,
    "",
    `_Generated ${meta.generated} with Encoding Helper v${meta.version} · ${meta.appUrl}_`,
    "",
  ];
  if (meta.facts.length) {
    lines.push(meta.facts.map(([k, v]) => `**${k}:** ${v}`).join(" · "), "");
  }
  sections.forEach((sec) => {
    lines.push(`## ${sec.title}`, "");
    sec.blocks.forEach((block) => lines.push(...markdownBlock(block)));
  });
  return lines.join("\n");
}

function escapeHtmlText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * The whole document as one self-contained HTML string: no external stylesheet, no script, no
 * fetched asset, so it opens the same from a downloads folder as it does in the preview.
 */
export function buildAnalysisDocument(sections: AnalysisSection[], meta: DocumentMeta): string {
  const holder = document.createElement("div");
  holder.append(renderSectionsToHtml(sections));
  const facts = meta.facts
    .map(
      ([k, v]) =>
        `<div class="fact"><span class="fact-key">${escapeHtmlText(k)}</span>` +
        `<span class="fact-val">${escapeHtmlText(v)}</span></div>`,
    )
    .join("");
  const contents = sections
    .map((s) => `<li><a href="#${slugify(s.title)}">${escapeHtmlText(s.title)}</a></li>`)
    .join("");
  const title = `Encoding Helper analysis: ${meta.fileName}`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Encoding Helper v${escapeHtmlText(meta.version)}">
<title>${escapeHtmlText(title)}</title>
<style>
${ANALYSIS_DOC_CSS}
</style>
</head>
<body>
<article class="doc">
<header class="doc-head">
<p class="doc-eyebrow">Encoding Helper &middot; Full Analysis</p>
<h1>${escapeHtmlText(meta.fileName)}</h1>
<p class="doc-meta">Generated ${escapeHtmlText(meta.generated)} &middot; v${escapeHtmlText(meta.version)} &middot;
<a href="${escapeHtmlText(meta.appUrl)}">${escapeHtmlText(meta.appUrl)}</a></p>
${facts ? `<div class="doc-facts">${facts}</div>` : ""}
</header>
<nav class="doc-toc" aria-label="Contents">
<h2>Contents</h2>
<ol>${contents}</ol>
</nav>
${holder.innerHTML}
<footer class="doc-foot">
<p>Measured in the browser from the file's own container and sample table; no part of the video was
uploaded. Reproduce it by loading the same file at <a href="${escapeHtmlText(meta.appUrl)}">${escapeHtmlText(
    meta.appUrl,
  )}</a>.</p>
</footer>
</article>
</body>
</html>
`;
}

/**
 * The document's own stylesheet, inlined into every exported copy. It reuses the app's class names
 * (.section, .grid, .teach, table.data, the two chart classes) so the section builders emit one set
 * of DOM for both, but the values here are a fixed paper palette rather than the app's theme
 * variables: an exported file has no app around it to inherit a theme from.
 */
export const ANALYSIS_DOC_CSS = `
:root {
  --ink: #1c2333;
  --ink-strong: #0b1020;
  --muted: #5b6478;
  --faint: #7b8296;
  --accent: #4f46e5;
  --rule: #e4e8f2;
  --card: #ffffff;
  --sunken: #f2f4fa;
  --teach: #eef2ff;
  --page: #f6f7fb;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 32px 20px 64px;
  background: var(--page);
  color: var(--ink);
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  line-height: 1.6;
  font-size: 15px;
}
.doc {
  max-width: 860px;
  margin: 0 auto;
  padding: 40px 44px 48px;
  background: var(--card);
  border: 1px solid var(--rule);
  border-radius: 10px;
  box-shadow: 0 10px 40px rgb(15 23 42 / 0.08);
}
a { color: var(--accent); }
.doc-head { border-bottom: 2px solid var(--accent); padding-bottom: 18px; }
.doc-eyebrow {
  margin: 0;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 1.2px;
  text-transform: uppercase;
  color: var(--accent);
}
.doc-head h1 {
  margin: 6px 0 4px;
  font-size: 30px;
  line-height: 1.2;
  color: var(--ink-strong);
  word-break: break-word;
}
.doc-meta { margin: 0; font-size: 12px; color: var(--muted); }
.doc-facts {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 28px;
  margin-top: 18px;
}
.fact { display: flex; flex-direction: column; }
.fact-key {
  font-size: 10px;
  letter-spacing: 0.6px;
  text-transform: uppercase;
  color: var(--faint);
}
.fact-val { font-size: 15px; font-weight: 600; color: var(--ink-strong); }
.doc-toc { margin: 26px 0 8px; }
.doc-toc h2 {
  margin: 0 0 6px;
  font-size: 11px;
  letter-spacing: 0.8px;
  text-transform: uppercase;
  color: var(--muted);
}
.doc-toc ol {
  columns: 2;
  column-gap: 32px;
  margin: 0;
  padding-left: 20px;
  font-size: 13px;
}
.doc-toc li { break-inside: avoid; margin: 2px 0; }
.section {
  margin: 26px 0;
  padding-top: 20px;
  border-top: 1px solid var(--rule);
  break-inside: auto;
}
.section h2 {
  margin: 0 0 14px;
  font-size: 13px;
  letter-spacing: 0.6px;
  text-transform: uppercase;
  color: var(--muted);
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 12px 20px;
  margin-bottom: 12px;
}
.grid .item { break-inside: avoid; }
.grid .item label {
  display: block;
  font-size: 10px;
  letter-spacing: 0.4px;
  text-transform: uppercase;
  color: var(--faint);
  margin-bottom: 2px;
}
.grid .item label.raw { text-transform: none; font-family: ui-monospace, Menlo, Consolas, monospace; }
.grid .item .val { font-size: 16px; font-weight: 600; color: var(--accent); word-break: break-word; }
.grid .item .val.sm {
  font-size: 12.5px;
  font-weight: 400;
  color: var(--ink);
  font-family: ui-monospace, Menlo, Consolas, monospace;
}
.grid .item.wide { grid-column: span 2; }
.teach {
  background: var(--teach);
  border-left: 3px solid var(--accent);
  border-radius: 0 4px 4px 0;
  padding: 10px 14px;
  margin: 12px 0;
  font-size: 13px;
  color: #333a4d;
}
.teach b { color: var(--ink-strong); }
.teach p { margin: 8px 0 0; }
.teach ul { margin: 8px 0 0; padding-left: 22px; }
.teach code, .doc code {
  font-family: ui-monospace, Menlo, Consolas, monospace;
  font-size: 0.92em;
}
.badge-row { margin: 10px 0; }
.badge {
  display: inline-block;
  padding: 3px 10px;
  border-radius: 20px;
  font-size: 12px;
  font-weight: 600;
}
.badge.good { background: #e6f9ee; color: #1a7d42; }
.badge.bad { background: #fff4e0; color: #92620a; }
.badge.info { background: #e8effe; color: var(--accent); }
pre.cmd {
  background: var(--sunken);
  border: 1px solid var(--rule);
  border-radius: 6px;
  padding: 12px 14px;
  margin: 10px 0;
  font-family: ui-monospace, Menlo, Consolas, monospace;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  color: #1f2b52;
}
.scroll-x { overflow-x: auto; }
table.data { width: 100%; border-collapse: collapse; font-size: 13px; margin: 6px 0; }
table.data th, table.data td { text-align: left; padding: 5px 8px; border-bottom: 1px solid var(--rule); }
table.data th {
  font-size: 10px;
  letter-spacing: 0.4px;
  text-transform: uppercase;
  color: var(--muted);
}
.fig { margin: 14px 0; padding: 0; break-inside: avoid; }
.fig figcaption { margin-top: 4px; font-size: 12px; color: var(--muted); }
.hist { display: flex; align-items: flex-end; gap: 2px; height: 90px; }
.hist .bar { flex: 1; min-height: 2px; background: var(--accent); border-radius: 2px 2px 0 0; }
.hist .bar.tall { background: #92620a; }
.bitrate-chart, .seek-scatter {
  display: block;
  width: 100%;
  max-width: 600px;
  height: auto;
  font-family: system-ui, -apple-system, sans-serif;
}
.bitrate-chart .grid-line, .seek-scatter .grid-line { stroke: var(--rule); }
.bitrate-chart .axis, .seek-scatter .axis { stroke: #b6bdd0; }
.bitrate-chart .tick, .seek-scatter .tick { fill: var(--muted); }
.bitrate-chart .axis-title, .seek-scatter .axis-title { fill: var(--muted); }
.bitrate-chart .area { fill: rgb(79 70 229 / 0.12); }
.bitrate-chart .line { stroke: var(--accent); }
.bitrate-chart .avg-line { stroke: var(--muted); }
.bitrate-chart .avg-label { fill: var(--muted); stroke: var(--card); stroke-width: 3; paint-order: stroke; }
.bitrate-chart .band { fill: transparent; }
.bitrate-chart .cross, .bitrate-chart .dot { opacity: 0; }
.seek-scatter .pt { fill: var(--accent); stroke: var(--card); }
.doc-foot {
  margin-top: 32px;
  padding-top: 16px;
  border-top: 1px solid var(--rule);
  font-size: 12px;
  color: var(--muted);
}
.doc-foot p { margin: 0; }
@media (max-width: 640px) {
  body { padding: 16px 10px 40px; }
  .doc { padding: 24px 18px 32px; }
  .doc-toc ol { columns: 1; }
}
@media print {
  @page { margin: 14mm; }
  body { padding: 0; background: #fff; font-size: 11pt; }
  .doc { max-width: none; padding: 0; border: none; border-radius: 0; box-shadow: none; }
  .section { break-inside: auto; }
  .section h2 { break-after: avoid; }
  .fig, .grid .item, table.data tr { break-inside: avoid; }
  a { color: var(--ink); text-decoration: none; }
}
`;
