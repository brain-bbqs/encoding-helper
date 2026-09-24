// Checked against index.html itself rather than a hand-written skeleton, so an id renamed in one
// place and not the other fails here instead of at startup in the browser.

import { mountHtml, readIndexHtml } from "@brain-bbqs/test-utils/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { getElements } from "../../src/ui/elements";

const INDEX_HTML = readIndexHtml();

afterEach(() => {
  document.body.innerHTML = "";
});

describe("getElements", () => {
  it("finds every element the app looks up in the real index.html", () => {
    mountHtml(INDEX_HTML);
    const els = getElements();
    expect(els.dropZone.id).toBe("dropZone");
    expect(els.urlInput).toBeInstanceOf(HTMLInputElement);
    expect(els.versionIndicator.id).toBe("version-indicator");
    expect(els.clearCacheBtn.id).toBe("clear-matrix-cache-btn");
    expect(Object.keys(els.panels)).toEqual(["inspect", "encode", "compare", "analysis"]);
    expect(els.panels.analysis.id).toBe("panel-analysis");
  });

  it("names the element that is missing rather than handing back a null", () => {
    mountHtml(INDEX_HTML);
    document.getElementById("themeToggle")!.remove();
    expect(() => getElements()).toThrow("Expected #themeToggle to exist in the document");
  });
});
