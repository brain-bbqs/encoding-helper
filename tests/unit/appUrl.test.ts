import { beforeEach, describe, expect, it } from "vitest";
import { isTabId, readSrcFromUrl, readTabFromUrl, writeSrcToUrl, writeTabToUrl } from "../../src/lib/appUrl";

function setUrl(search: string): void {
  window.history.replaceState({}, "", "/encoding-helper/" + search);
}

describe("appUrl", () => {
  beforeEach(() => setUrl(""));

  it("recognizes only the tabs the app actually has", () => {
    expect(isTabId("inspect")).toBe(true);
    expect(isTabId("compare")).toBe(true);
    expect(isTabId("nope")).toBe(false);
    expect(isTabId(null)).toBe(false);
  });

  it("reads the tab out of the query string, ignoring unknown names", () => {
    expect(readTabFromUrl()).toBeNull();
    setUrl("?tab=seek");
    expect(readTabFromUrl()).toBe("seek");
    setUrl("?tab=made-up");
    expect(readTabFromUrl()).toBeNull();
  });

  it("writes the tab without disturbing the rest of the URL", () => {
    setUrl("?src=https%3A%2F%2Fexample.com%2Fa.mp4");
    writeTabToUrl("report", false);
    expect(readTabFromUrl()).toBe("report");
    expect(readSrcFromUrl()).toBe("https://example.com/a.mp4");
  });

  it("pushes a history entry only when asked, so back walks the tabs", () => {
    const before = window.history.length;
    writeTabToUrl("atoms", false);
    expect(window.history.length).toBe(before);
    writeTabToUrl("encode", true);
    expect(window.history.length).toBeGreaterThan(before);
  });

  it("skips the write when the tab is already the one in the URL", () => {
    writeTabToUrl("atoms", false);
    const before = window.history.length;
    writeTabToUrl("atoms", true);
    expect(window.history.length).toBe(before);
  });

  it("accepts only http(s) source URLs", () => {
    setUrl("?src=https%3A%2F%2Fexample.com%2Fclip.mp4");
    expect(readSrcFromUrl()).toBe("https://example.com/clip.mp4");
    setUrl("?src=javascript%3Aalert(1)");
    expect(readSrcFromUrl()).toBeNull();
    setUrl("?src=blob%3Ahttps%3A%2F%2Fexample.com%2Fabc");
    expect(readSrcFromUrl()).toBeNull();
  });

  it("clears the source parameter when passed null, e.g. after a local file is loaded", () => {
    writeSrcToUrl("https://example.com/clip.mp4");
    expect(readSrcFromUrl()).toBe("https://example.com/clip.mp4");
    writeSrcToUrl(null);
    expect(readSrcFromUrl()).toBeNull();
    expect(window.location.search).toBe("");
  });
});
