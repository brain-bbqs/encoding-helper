import { beforeEach, describe, expect, it } from "vitest";
import {
  isTabId,
  readDemosFromUrl,
  readEducationalFromUrl,
  readSrcFromUrl,
  readTabFromUrl,
  writeDemosToUrl,
  writeEducationalToUrl,
  writeSrcToUrl,
  writeTabToUrl,
} from "../../src/lib/appUrl";

function setUrl(search: string): void {
  window.history.replaceState({}, "", "/encoding-helper/" + search);
}

describe("appUrl", () => {
  beforeEach(() => setUrl(""));

  it("recognizes only the tabs the app actually has", () => {
    expect(isTabId("inspect")).toBe(true);
    expect(isTabId("compare")).toBe(true);
    expect(isTabId("encode")).toBe(true);
    expect(isTabId("reencode")).toBe(false);
    expect(isTabId("nope")).toBe(false);
    expect(isTabId(null)).toBe(false);
  });

  it("reads the tab out of the query string, ignoring unknown names", () => {
    expect(readTabFromUrl()).toBeNull();
    setUrl("?tab=compare");
    expect(readTabFromUrl()).toBe("compare");
    setUrl("?tab=made-up");
    expect(readTabFromUrl()).toBeNull();
  });

  // The atom map, the seeking test and the in-browser encode are sections of other tabs now, so a
  // link someone was sent still opens where that content went.
  it("sends a link naming a retired tab to the tab its content moved to", () => {
    setUrl("?tab=atoms");
    expect(readTabFromUrl()).toBe("inspect");
    setUrl("?tab=seek");
    expect(readTabFromUrl()).toBe("inspect");
    setUrl("?tab=reencode");
    expect(readTabFromUrl()).toBe("encode");
  });

  it("rewrites a retired tab name to the current one when it is recorded", () => {
    setUrl("?tab=reencode");
    writeTabToUrl("encode", false);
    expect(window.location.search).toBe("?tab=encode");
  });

  it("writes the tab without disturbing the rest of the URL", () => {
    setUrl("?src=https%3A%2F%2Fexample.com%2Fa.mp4");
    writeTabToUrl("analysis", false);
    expect(readTabFromUrl()).toBe("analysis");
    expect(readSrcFromUrl()).toBe("https://example.com/a.mp4");
  });

  it("pushes a history entry only when asked, so back walks the tabs", () => {
    const before = window.history.length;
    writeTabToUrl("compare", false);
    expect(window.history.length).toBe(before);
    writeTabToUrl("encode", true);
    expect(window.history.length).toBeGreaterThan(before);
  });

  it("skips the write when the tab is already the one in the URL", () => {
    writeTabToUrl("compare", false);
    const before = window.history.length;
    writeTabToUrl("compare", true);
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

  // A link someone wrote by hand can carry something the URL parser cannot make sense of at all.
  it("reads an unparsable source as no source", () => {
    setUrl("?src=http%3A%2F%2F");
    expect(readSrcFromUrl()).toBeNull();
  });

  it("reads the Educational switch only when the URL states it", () => {
    expect(readEducationalFromUrl()).toBeNull();
    writeEducationalToUrl(true);
    expect(window.location.search).toBe("?edu=1");
    expect(readEducationalFromUrl()).toBe(true);
    writeEducationalToUrl(false);
    expect(readEducationalFromUrl()).toBe(false);
  });

  it("clears the source parameter when passed null, e.g. after a local file is loaded", () => {
    writeSrcToUrl("https://example.com/clip.mp4");
    expect(readSrcFromUrl()).toBe("https://example.com/clip.mp4");
    writeSrcToUrl(null);
    expect(readSrcFromUrl()).toBeNull();
    expect(window.location.search).toBe("");
  });
  // `demos` is a flag rather than a value: the demos page is somewhere the app is, not something it
  // is set to, and `?demos` is what someone would type.
  it("reads the demos flag bare, alongside the other parameters, in either order", () => {
    expect(readDemosFromUrl()).toBe(false);
    setUrl("?demos");
    expect(readDemosFromUrl()).toBe(true);
    setUrl("?tab=encode&demos");
    expect(readDemosFromUrl()).toBe(true);
    setUrl("?demos&tab=encode");
    expect(readDemosFromUrl()).toBe(true);
  });

  it("honours an explicit ?demos=0 as an off switch", () => {
    setUrl("?demos=0");
    expect(readDemosFromUrl()).toBe(false);
  });

  it("writes the demos flag bare and first, keeping the rest of the query string", () => {
    setUrl("?tab=encode&edu=0");
    writeDemosToUrl(true, false);
    expect(window.location.search).toBe("?demos&tab=encode&edu=0");
    expect(readTabFromUrl()).toBe("encode");
  });

  it("takes the demos flag back out without leaving a stray question mark", () => {
    setUrl("?demos");
    writeDemosToUrl(false, false);
    expect(window.location.search).toBe("");
    setUrl("?demos&tab=encode");
    writeDemosToUrl(false, false);
    expect(window.location.search).toBe("?tab=encode");
  });

  it("pushes a history entry for the demos flag only when asked", () => {
    const before = window.history.length;
    writeDemosToUrl(true, false);
    expect(window.history.length).toBe(before);
    writeDemosToUrl(false, true);
    expect(window.history.length).toBeGreaterThan(before);
  });

  it("skips the write when the address already says what it would say", () => {
    setUrl("?demos");
    const before = window.history.length;
    writeDemosToUrl(true, true);
    expect(window.location.search).toBe("?demos");
    expect(window.history.length).toBe(before);
  });
});
