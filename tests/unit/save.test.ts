import { afterEach, describe, expect, it, vi } from "vitest";
import { baseNameOf, downloadBlob, extOf, pickSaveTarget } from "../../src/lib/save";

describe("extOf", () => {
  it("keeps the file's own extension", () => {
    expect(extOf("clip.mp4")).toBe(".mp4");
    expect(extOf("archive.tar.gz")).toBe(".gz");
    expect(extOf("CLIP.MOV")).toBe(".MOV");
  });

  it("falls back to .mp4 when there is nothing to read", () => {
    expect(extOf("clip")).toBe(".mp4");
    expect(extOf("")).toBe(".mp4");
    expect(extOf(null)).toBe(".mp4");
    expect(extOf(undefined)).toBe(".mp4");
  });

  it("ignores a dot that is not followed by an extension", () => {
    expect(extOf("weird.name.")).toBe(".mp4");
  });
});

describe("baseNameOf", () => {
  it("drops the last extension only", () => {
    expect(baseNameOf("clip.mp4")).toBe("clip");
    expect(baseNameOf("archive.tar.gz")).toBe("archive.tar");
  });

  it("leaves a name that has no extension alone", () => {
    expect(baseNameOf("clip")).toBe("clip");
  });

  it("calls an unnamed file 'video'", () => {
    expect(baseNameOf(null)).toBe("video");
    expect(baseNameOf("")).toBe("video");
  });
});

/** Installs a showSaveFilePicker for the duration of a test, and takes it away after. */
function stubPicker(impl: unknown): void {
  Object.defineProperty(window, "showSaveFilePicker", { value: impl, configurable: true, writable: true });
}

afterEach(() => {
  Reflect.deleteProperty(window, "showSaveFilePicker");
  vi.restoreAllMocks();
});

describe("pickSaveTarget", () => {
  it("buffers when the browser has no save picker", async () => {
    expect(await pickSaveTarget("clip.mp4")).toEqual({ kind: "buffer" });
  });

  it("streams to the handle the picker returned", async () => {
    const writable = { write: vi.fn() };
    const createWritable = vi.fn().mockResolvedValue(writable);
    const picker = vi.fn().mockResolvedValue({ createWritable });
    stubPicker(picker);

    const target = await pickSaveTarget("clip.mp4");

    expect(target).toEqual({ kind: "stream", writable });
    expect(picker.mock.calls[0][0]).toMatchObject({ suggestedName: "clip.mp4" });
  });

  it("returns nothing when the reader dismissed the picker", async () => {
    stubPicker(vi.fn().mockRejectedValue(new DOMException("cancelled", "AbortError")));
    expect(await pickSaveTarget("clip.mp4")).toBeNull();
  });

  it("falls back to a download when the picker itself fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    stubPicker(vi.fn().mockRejectedValue(new Error("not allowed")));
    expect(await pickSaveTarget("clip.mp4")).toEqual({ kind: "buffer" });
  });
});

describe("downloadBlob", () => {
  it("clicks a named link and cleans up after itself", () => {
    vi.useFakeTimers();
    const createObjectURL = vi.fn().mockReturnValue("blob:fake");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { value: createObjectURL, configurable: true });
    Object.defineProperty(URL, "revokeObjectURL", { value: revokeObjectURL, configurable: true });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      // Read while the link is still in the document, which is where the click has to happen.
      expect(this.download).toBe("clip.analysis.html");
      expect(this.href).toBe("blob:fake");
      expect(this.isConnected).toBe(true);
    });

    downloadBlob(new Blob(["<html></html>"], { type: "text/html" }), "clip.analysis.html");

    expect(click).toHaveBeenCalledOnce();
    expect(document.querySelector("a")).toBeNull();
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:fake");
    vi.useRealTimers();
  });
});
