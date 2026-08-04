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

  static async fromUrl(url: string): Promise<ChunkedSource> {
    const s = new ChunkedSource();
    s.kind = "url";
    s.url = url;
    s.name = url.split("/").pop()?.split("?")[0] || "video";
    const head = await fetch(url, { method: "HEAD" });
    if (!head.ok) throw new Error(`Failed to fetch URL: ${head.status} ${head.statusText}`);
    s.size = parseInt(head.headers.get("Content-Length") || "", 10) || 0;
    s.supportsRange = head.headers.get("Accept-Ranges") === "bytes" && s.size > 0;
    if (!s.supportsRange) {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`Failed to fetch URL: ${resp.status} ${resp.statusText}`);
      const blob = await resp.blob();
      s.kind = "file";
      s.file = new File([blob], s.name, { type: blob.type || "video/mp4" });
      s.size = blob.size;
    }
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
