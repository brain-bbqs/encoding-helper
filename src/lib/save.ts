// Save-to-disk helper (File System Access API with download fallback).

export function extOf(name: string | null | undefined): string {
  const m = /\.[a-zA-Z0-9]+$/.exec(name || "");
  return m ? m[0] : ".mp4";
}

export type SaveTarget =
  { kind: "stream"; handle: FileSystemFileHandle; writable: FileSystemWritableFileStream } | { kind: "buffer" };

export async function pickSaveTarget(suggestedName: string): Promise<SaveTarget | null> {
  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName,
        types: [{ description: "MP4 video", accept: { "video/mp4": [".mp4"] } }],
      });
      const writable = await handle.createWritable();
      return { kind: "stream", handle, writable };
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return null;
      console.warn("[encoding-helper] showSaveFilePicker failed, falling back to download:", e);
    }
  }
  return { kind: "buffer" };
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
