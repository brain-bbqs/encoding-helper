// src/style.css draws the page; src/lib/analysisDoc.ts inlines its own sheet into every exported Full Analysis
// document, reusing the page's class names so one set of section builders serves both. A partial shared by the two
// would reorder the page's cascade, and CSS cannot share one block between the page's two dark palettes, so nothing
// but this file holds them equal (DUP-2 and DUP-3 in docs/code-reviews/2026-11-22-code-quality-review.md).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildAnalysisDocument } from "../../src/lib/analysisDoc";

/**
 * Where the two sheets mean to differ: each selector they share, with the properties both declare that may hold
 * different values. Properties declared in one sheet only need no entry.
 */
const INTENDED_DIFFERENCES: Readonly<Record<string, readonly string[]>> = {
  // Type and layout: the document is set for print, with its own monospace stack, sizes, spacing and a grid for its
  // fields (see the docstring above ANALYSIS_DOC_CSS).
  ".section h2": ["margin", "letter-spacing"],
  ".grid": ["display", "gap"],
  ".grid .item label": ["font-size"],
  ".grid .item label.raw": ["font-family"],
  ".grid .item .val.sm": ["font-size", "font-family"],
  "table.data th": ["font-size"],
  ".atom-block": ["font-family"],
  ".legend-label": ["font-family"],
  "pre.cmd": [
    "font-family",
    "font-size",
    "word-break",
    // The page's block sits in a .cmd-wrap that carries its margin; the document's stands alone.
    "margin",
    // Through --sunken: one of the colours below.
    "background",
  ],
  // Colours that have differed since the document's sheet was created (cfaf80f, #17): the info badge, the two
  // charts' axes and axis titles, and the command block's background above. Whether they should match is an open
  // question.
  ".badge.info": ["background"],
  ".bitrate-chart .axis": ["stroke"],
  ".seek-scatter .axis": ["stroke"],
  ".bitrate-chart .axis-title": ["fill"],
  ".seek-scatter .axis-title": ["fill"],
};

/** A declaration as [property, value], spacing and letter case normalised. */
type Declaration = [property: string, value: string];
/** What a sheet declares for one selector: property to value. */
type Declarations = Map<string, string>;

interface Block {
  prelude: string;
  body: string;
}

interface StyleRule {
  selectors: string[];
  declarations: Declaration[];
}

interface Difference {
  selector: string;
  property: string;
  page: string;
  document: string;
}

const PAGE_CSS = readFileSync(resolve(process.cwd(), "src/style.css"), "utf-8");
const PAGE = declarationsBySelector(PAGE_CSS);
const DOCUMENT = declarationsBySelector(documentStylesheet());
const SHARED = [...DOCUMENT.keys()].filter((selector) => PAGE.has(selector));

describe("the page's dark palette", () => {
  it("is the same for the OS preference as for the header toggle, property for property", () => {
    const forPreference = customProperties(
      topLevelBlocks(PAGE_CSS)
        .filter((block) => block.prelude === "@media (prefers-color-scheme: dark)")
        .flatMap((block) => styleRules(block.body)),
      ':root:not([data-theme="light"])',
    );
    const forToggle = customProperties(styleRules(PAGE_CSS), ':root[data-theme="dark"]');

    // So that two lists the extraction left empty cannot pass as equal.
    expect(forPreference.map(([property]) => property)).toContain("--accent");
    expect(forToggle).toEqual(forPreference);
  });
});

describe("the page stylesheet and the Full Analysis document's stylesheet", () => {
  it("are each read to their last style rule", () => {
    // A parser that stopped early, at an at-rule, a string or a brace it miscounted, would miss these.
    expect(PAGE.has(".demos-error-hint"), "the page's last rule").toBe(true);
    expect(DOCUMENT.has(".seek-scatter .pt"), "the document's last style rule").toBe(true);
  });

  it("give each selector they share the same value for every property both declare, bar INTENDED_DIFFERENCES", () => {
    const unlisted = differences().filter(
      ({ selector, property }) => !INTENDED_DIFFERENCES[selector]?.includes(property),
    );
    expect(unlisted).toEqual([]);
  });

  it("still differ in every property INTENDED_DIFFERENCES lists, so none of its entries is stale", () => {
    expect(staleEntries()).toEqual([]);
  });
});

/** The document's stylesheet as an exported file carries it: the content of its one <style> element. */
function documentStylesheet(): string {
  const html = buildAnalysisDocument([], { fileName: "a.mp4", generated: "", version: "0.0.0", appUrl: "", facts: [] });
  return new DOMParser().parseFromString(html, "text/html").querySelector("style")?.textContent ?? "";
}

/** Each property both sheets declare for a selector they share, where the two values differ. */
function differences(): Difference[] {
  return SHARED.flatMap((selector) => {
    const [inPage, inDocument] = bothSheets(selector);
    return [...inDocument]
      .filter(([property, value]) => inPage.has(property) && inPage.get(property) !== value)
      .map(([property, value]) => ({ selector, property, page: inPage.get(property) ?? "", document: value }));
  });
}

/** What to delete from INTENDED_DIFFERENCES: entries whose selector, property or difference has gone. */
function staleEntries(): string[] {
  return Object.entries(INTENDED_DIFFERENCES).flatMap(([selector, properties]) => {
    if (!SHARED.includes(selector)) return [`delete "${selector}": it is no longer in both sheets`];
    const [inPage, inDocument] = bothSheets(selector);
    return properties.flatMap((property) => {
      const page = inPage.get(property);
      const document = inDocument.get(property);
      if (page === undefined || document === undefined) {
        return [`delete "${property}" from "${selector}": it is no longer declared in both sheets`];
      }
      return page === document ? [`delete "${property}" from "${selector}": both sheets now give it ${page}`] : [];
    });
  });
}

function bothSheets(selector: string): [Declarations, Declarations] {
  return [PAGE.get(selector) ?? new Map(), DOCUMENT.get(selector) ?? new Map()];
}

/**
 * Each class selector a sheet's top-level style rules name, with what they declare for it (a later rule's value
 * replacing an earlier one's) and every var() resolved against the sheet's light palette.
 */
function declarationsBySelector(css: string): Map<string, Declarations> {
  const rules = styleRules(css);
  const palette = new Map(customProperties(rules, ":root"));
  const bySelector = new Map<string, Declarations>();
  for (const rule of rules) {
    for (const selector of rule.selectors.filter(hasClass)) {
      const declarations = bySelector.get(selector) ?? new Map<string, string>();
      rule.declarations.forEach(([property, value]) => declarations.set(property, resolveVars(value, palette)));
      bySelector.set(selector, declarations);
    }
  }
  return bySelector;
}

/** Whether a selector names a class, which leaves out *, :root, a, body and other bare elements. */
function hasClass(selector: string): boolean {
  return /\.[A-Za-z_-]/.test(selector.replace(/\[[^\]]*\]/g, ""));
}

/** The custom properties the rules for exactly `selector` set, in source order. */
function customProperties(rules: StyleRule[], selector: string): Declaration[] {
  return rules
    .filter((rule) => rule.selectors.includes(selector))
    .flatMap((rule) => rule.declarations.filter(([property]) => property.startsWith("--")));
}

/**
 * `value` with each var() the palette defines replaced by its value, nested forms and fallbacks included. A variable
 * the palette lacks stays as written: some are set per element, and the page's shell sheets are not read here.
 */
function resolveVars(value: string, palette: Declarations): string {
  const start = value.indexOf("var(");
  if (start === -1) return value;
  const end = closingIndex(value, start + 3, "(", ")");
  const [name = "", ...fallback] = splitOutside(value.slice(start + 4, end), ",");
  const defined = palette.get(name);
  const replacement =
    defined !== undefined
      ? resolveVars(defined, palette)
      : `var(${[name, ...fallback.map((part) => resolveVars(part, palette))].join(", ")})`;
  return value.slice(0, start) + replacement + resolveVars(value.slice(end + 1), palette);
}

// The parser. jsdom's CSSOM reads both sheets too, but moves `!important` out of the value and reports an error for
// each of the page's @imports of a package path, so a few lines here do it instead: strip comments, match braces,
// skip at-rules.

/** The style rules at the top level of `css`; at-rules (@media, @supports, @keyframes) are skipped whole. */
function styleRules(css: string): StyleRule[] {
  return topLevelBlocks(css)
    .filter((block) => !block.prelude.startsWith("@"))
    .map((block) => ({
      selectors: splitOutside(block.prelude, ",").map(normaliseSelector),
      declarations: splitOutside(block.body, ";").map(parseDeclaration),
    }));
}

/** The `{...}` blocks at the top level of `css`, comments removed, each with the prelude that heads it. */
function topLevelBlocks(css: string): Block[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const blocks: Block[] = [];
  let start = 0;
  for (let open = text.indexOf("{"); open !== -1; open = text.indexOf("{", start)) {
    const close = closingIndex(text, open, "{", "}");
    // A statement such as `@import "...";` ends at its semicolon, so only what follows the last one heads the block.
    const prelude = text.slice(start, open).split(";").pop() ?? "";
    blocks.push({ prelude: collapseSpace(prelude), body: text.slice(open + 1, close) });
    start = close + 1;
  }
  return blocks;
}

/** The index of the bracket that closes the one at `open`. */
function closingIndex(text: string, open: number, opener: string, closer: string): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === opener) depth++;
    else if (text[i] === closer && --depth === 0) return i;
  }
  throw new Error(`Nothing closes the ${opener} at offset ${open}`);
}

/** `text` cut at each `separator` outside brackets and quotes; pieces trimmed, empty ones dropped. */
function splitOutside(text: string, separator: string): string[] {
  const pieces = [""];
  let depth = 0;
  let quote = "";
  for (const char of text) {
    if (quote) quote = char === quote ? "" : quote;
    else if (char === '"' || char === "'") quote = char;
    else if (char === "(" || char === "[") depth++;
    else if (char === ")" || char === "]") depth--;
    else if (char === separator && depth === 0) {
      pieces.push("");
      continue;
    }
    pieces[pieces.length - 1] += char;
  }
  return pieces.map((piece) => piece.trim()).filter(Boolean);
}

function parseDeclaration(text: string): Declaration {
  const colon = text.indexOf(":");
  if (colon < 1) throw new Error(`Not a declaration: ${text}`);
  const property = text.slice(0, colon).trim();
  return [property.startsWith("--") ? property : property.toLowerCase(), normaliseValue(text.slice(colon + 1))];
}

function collapseSpace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** A selector with uniform spacing, around the > + ~ combinators too. */
function normaliseSelector(selector: string): string {
  return collapseSpace(selector).replace(/ ?([>+~])(?!=) ?/g, " $1 ");
}

/** A value without the spacing and letter case a reformat could change: strings and variable names keep theirs. */
function normaliseValue(value: string): string {
  return collapseSpace(value)
    .replace(/ ?, ?/g, ", ")
    .replace(/\( /g, "(")
    .replace(/ \)/g, ")")
    .replace(/ ?! ?important/gi, " !important")
    .replace(/("[^"]*"|'[^']*'|--[\w-]+)|[A-Z]/g, (letter: string, kept?: string) => kept ?? letter.toLowerCase());
}
