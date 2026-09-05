// Checked against index.html itself rather than a hand-written skeleton, so an id renamed in one
// place and not the other fails here instead of at startup in the browser.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getElements } from "../../src/ui/elements";

// Resolved from the vitest root (the repo), since the test itself runs in jsdom under an http: URL.
const INDEX_HTML = readFileSync(resolve(process.cwd(), "index.html"), "utf8");

afterEach(() => {
  document.body.innerHTML = "";
});

/** index.html's `<body>`, which is the skeleton the lookups are written against. */
function mountIndexHtml(): void {
  document.body.innerHTML = /<body[^>]*>([\s\S]*)<\/body>/.exec(INDEX_HTML)![1];
}

describe("getElements", () => {
  it("finds every element the app looks up in the real index.html", () => {
    mountIndexHtml();
    const els = getElements();
    expect(els.dropZone.id).toBe("dropZone");
    expect(els.urlInput).toBeInstanceOf(HTMLInputElement);
    expect(els.versionIndicator.id).toBe("version-indicator");
    expect(els.clearCacheBtn.id).toBe("clear-matrix-cache-btn");
    expect(Object.keys(els.panels)).toEqual(["inspect", "encode", "compare", "analysis"]);
    expect(els.panels.analysis.id).toBe("panel-analysis");
  });

  it("names the element that is missing rather than handing back a null", () => {
    mountIndexHtml();
    document.getElementById("themeToggle")!.remove();
    expect(() => getElements()).toThrow("Expected #themeToggle to exist in the document");
  });
});
