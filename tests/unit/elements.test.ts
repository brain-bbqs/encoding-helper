// Checked against index.html itself rather than a hand-written skeleton, so an id renamed in one
// place and not the other fails here instead of at startup in the browser.

import { expectIdContract, mountHtml, readIndexHtml } from "@brain-bbqs/test-utils/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { getElements } from "../../src/ui/elements";

const INDEX_HTML = readIndexHtml();

afterEach(() => {
  document.body.innerHTML = "";
});

describe("getElements", () => {
  it("agrees with the real index.html both ways, and finds every element the app looks up", () => {
    // Every id the lookups need is on the page, and every id on the page is one a lookup registers.
    expectIdContract({ html: INDEX_HTML, lookups: getElements });
    const els = getElements();
    expect(els.dropZone.id).toBe("dropZone");
    expect(els.urlInput).toBeInstanceOf(HTMLInputElement);
    expect(els.versionIndicator.id).toBe("version-indicator");
    expect(els.clearCacheBtn.id).toBe("clear-matrix-cache-btn");
    expect(Object.keys(els.panels)).toEqual(["inspect", "encode", "compare", "analysis"]);
    expect(els.panels.analysis.id).toBe("panel-analysis");
    expect(els.whatsNew.button.id).toBe("whats-new-button");
    expect(els.whatsNew.dialog).toBeInstanceOf(HTMLDialogElement);
  });

  it("names the element that is missing rather than handing back a null", () => {
    mountHtml(INDEX_HTML);
    document.getElementById("themeToggle")!.remove();
    expect(() => getElements()).toThrow("Expected #themeToggle to exist in the document");
  });
});
