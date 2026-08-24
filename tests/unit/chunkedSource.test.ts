import { afterEach, describe, expect, it, vi } from "vitest";
import { ChunkedSource } from "../../src/lib/chunkedSource";

const URL_UNDER_TEST = "https://archive.test/api/assets/abc/download/";

/** A fetch stand-in built from per-call handlers, so each test says exactly what the server does. */
function stubFetch(handler: (url: string, init?: RequestInit) => unknown): ReturnType<typeof vi.fn> {
  const mock = vi.fn((url: string, init?: RequestInit) => Promise.resolve(handler(url, init)));
  vi.stubGlobal("fetch", mock);
  return mock;
}

function headers(map: Record<string, string>): { get: (name: string) => string | null } {
  return { get: (name: string) => map[name] ?? null };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ChunkedSource.fromUrl", () => {
  it("takes the size and range support from a HEAD when the server answers one", async () => {
    const mock = stubFetch(() => ({
      ok: true,
      status: 200,
      headers: headers({ "Content-Length": "4096", "Accept-Ranges": "bytes" }),
    }));
    const source = await ChunkedSource.fromUrl(URL_UNDER_TEST, "clip.mp4");
    expect(source.kind).toBe("url");
    expect(source.size).toBe(4096);
    expect(source.supportsRange).toBe(true);
    expect(source.name).toBe("clip.mp4");
    // One request: the HEAD answered everything.
    expect(mock.mock.calls.length).toBe(1);
  });

  // An archive that hands out pre-signed storage URLs signs them for GET alone, so HEAD is refused
  // on a file that is public and readable. This is what EMBER's download endpoint does.
  it("downloads the file whole when HEAD is refused, rather than failing", async () => {
    const blob = new Blob([new Uint8Array(1234)], { type: "video/mp4" });
    const mock = stubFetch((_url, init) => {
      if (init?.method === "HEAD") return { ok: false, status: 403, statusText: "Forbidden", headers: headers({}) };
      return { ok: true, status: 200, headers: headers({}), blob: () => Promise.resolve(blob) };
    });
    const source = await ChunkedSource.fromUrl(URL_UNDER_TEST, "clip.mp4");
    expect(source.kind).toBe("file");
    expect(source.size).toBe(1234);
    expect(source.supportsRange).toBe(false);
    expect(mock.mock.calls.length).toBe(2);
    // The whole-file GET carries no Range: a server that refused the HEAD has promised nothing.
    expect(mock.mock.calls[1][1]).toBeUndefined();
  });

  it("does the same when the HEAD fails outright rather than answering", async () => {
    const blob = new Blob([new Uint8Array(64)], { type: "video/mp4" });
    stubFetch((_url, init) => {
      if (init?.method === "HEAD") throw new Error("network");
      return { ok: true, status: 200, headers: headers({}), blob: () => Promise.resolve(blob) };
    });
    const source = await ChunkedSource.fromUrl(URL_UNDER_TEST);
    expect(source.kind).toBe("file");
    expect(source.size).toBe(64);
  });

  // A single byte range succeeding says nothing about the parser's real reads, and mediabunny reads
  // a URL source over ranges this class never sees — so ranges are taken only when advertised.
  it("does not take ranges on a server that never advertised them", async () => {
    const blob = new Blob([new Uint8Array(99)], { type: "video/mp4" });
    stubFetch((_url, init) => {
      if (init?.method === "HEAD") return { ok: true, status: 200, headers: headers({ "Content-Length": "99" }) };
      return { ok: true, status: 200, headers: headers({}), blob: () => Promise.resolve(blob) };
    });
    const source = await ChunkedSource.fromUrl(URL_UNDER_TEST);
    expect(source.kind).toBe("file");
    expect(source.supportsRange).toBe(false);
  });

  it("reports the status when the file really cannot be read", async () => {
    stubFetch(() => ({ ok: false, status: 404, statusText: "Not Found", headers: headers({}) }));
    await expect(ChunkedSource.fromUrl(URL_UNDER_TEST)).rejects.toThrow("Failed to fetch URL: 404 Not Found");
  });

  it("reports a refused range read instead of handing the parser an error page", async () => {
    stubFetch((_url, init) => {
      if (init?.method === "HEAD") {
        return { ok: true, status: 200, headers: headers({ "Content-Length": "4096", "Accept-Ranges": "bytes" }) };
      }
      return { ok: false, status: 403, statusText: "Forbidden", headers: headers({}) };
    });
    const source = await ChunkedSource.fromUrl(URL_UNDER_TEST);
    expect(source.supportsRange).toBe(true);
    await expect(source.readChunk(0, 512)).rejects.toThrow("Failed to read bytes 0-511: 403 Forbidden");
  });

  it("names the file from the URL, skipping a bare download endpoint", async () => {
    stubFetch(() => ({ ok: true, status: 200, headers: headers({ "Content-Length": "1", "Accept-Ranges": "bytes" }) }));
    expect((await ChunkedSource.fromUrl("https://example.com/a/clip.mp4")).name).toBe("clip.mp4");
    expect((await ChunkedSource.fromUrl(URL_UNDER_TEST)).name).toBe("video");
  });
});
