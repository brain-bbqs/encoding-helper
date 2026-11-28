// mediabunny is reached through a dynamic import rather than a plain top-level `import`, even
// though it's now an ordinary npm dependency, and `configs/vite.config.ts` chunks it separately.
// main.ts starts the import at startup, as the original CDN version did, and the accessor fetches
// the module once, caches it, and hands it to every caller (mp4box parsing/atom-map work never
// needs it at all).

type MediabunnyModule = typeof import("mediabunny");

let mbPromise: Promise<MediabunnyModule> | null = null;

export function ensureMediabunny(): Promise<MediabunnyModule> {
  // A failed import is not kept as the answer: kept, one dropped connection while the page opened
  // failed every file load after it until a reload.
  mbPromise ??= import("mediabunny").catch((err: unknown) => {
    mbPromise = null;
    throw err;
  });
  return mbPromise;
}
