// I/O layer: unifies File / File System Access handle / remote URL into one
// readChunk(offset, size) -> ArrayBuffer primitive.

export type ChunkedSourceKind = "file" | "url";

export class ChunkedSource {
  kind: ChunkedSourceKind | null = null;
  file: File | Blob | null = null; // kind === 'file', or a downloaded url fallback
  url: string | null = null;
  size = 0;
  name = "";
  supportsRange = false;

  static fromFile(file: File): ChunkedSource {
    const s = new ChunkedSource();
    s.kind = "file";
    s.file = file;
    s.size = file.size;
    s.name = file.name || "video";
    return s;
  }

  /**
   * A remote video, read with range requests where the server allows them.
   *
   * `name` overrides what the file is called in the app. The URL's last segment is the natural
   * source for that, but an archive's download endpoint ends in something like `/download/` rather
   * than a file name, so a caller that knows the real one passes it here.
   */
  static async fromUrl(url: string, name?: string): Promise<ChunkedSource> {
    const s = new ChunkedSource();
    s.kind = "url";
    s.url = url;
    const fromPath = url.split("?")[0].split("/").filter(Boolean).pop();
    s.name = name || (fromPath && fromPath !== "download" ? fromPath : "video");

    // How big is it, and can it be read in pieces? A HEAD is the polite way to ask, but not a
    // reliable one: an archive that hands out pre-signed storage URLs signs them for GET alone, so
    // HEAD comes back 403 on a file that is perfectly public (EMBER's DANDI download endpoint does
    // exactly this). A failed HEAD therefore means "no answer", not "no file".
    try {
      const head = await fetch(url, { method: "HEAD" });
      if (head.ok) {
        s.size = parseInt(head.headers.get("Content-Length") || "", 10) || 0;
        s.supportsRange = head.headers.get("Accept-Ranges") === "bytes" && s.size > 0;
      }
    } catch {
      // A network or CORS failure on the HEAD is one more way of not answering; the GET below is
      // what decides whether the file can be read at all.
    }
    if (s.supportsRange) return s;

    // Ask again with the method the signature covers. One byte is enough: a 206 both proves ranges
    // work and carries the full length in Content-Range, which is more than Accept-Ranges promised.
    const probe = await fetch(url, { headers: { Range: "bytes=0-0" } });
    if (!probe.ok) throw new Error(`Failed to fetch URL: ${probe.status} ${probe.statusText}`);
    const total = /\/\s*(\d+)\s*$/.exec(probe.headers.get("Content-Range") ?? "")?.[1];
    if (probe.status === 206 && total) {
      s.size = parseInt(total, 10);
      s.supportsRange = s.size > 0;
      if (s.supportsRange) return s;
    }

    // The server ignored the range and sent the whole file, so keep what already arrived rather
    // than asking for it a second time.
    const blob = await probe.blob();
    s.kind = "file";
    s.file = new File([blob], s.name, { type: blob.type || "video/mp4" });
    s.size = blob.size;
    return s;
  }

  async readChunk(offset: number, size: number): Promise<ArrayBuffer> {
    const end = Math.min(offset + size, this.size);
    if (end <= offset) return new ArrayBuffer(0);
    if (this.kind === "url" && this.url) {
      const resp = await fetch(this.url, { headers: { Range: `bytes=${offset}-${end - 1}` } });
      return await resp.arrayBuffer();
    }
    if (!this.file) return new ArrayBuffer(0);
    const blob = this.file.slice(offset, end);
    return await blob.arrayBuffer();
  }
}
