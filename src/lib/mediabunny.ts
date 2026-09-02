// mediabunny is loaded via a lazy dynamic import rather than a plain top-level `import` — even
// though it's now an ordinary npm dependency, the original CDN version deliberately deferred loading
// it until a file was actually dropped/picked, and `configs/vite.config.ts` already chunks it
// separately for that reason. Preserving the lazy accessor keeps that intent: the module is fetched
// once, cached, and reused by every caller (mp4box parsing/atom-map work never needs it at all).

type MediabunnyModule = typeof import("mediabunny");

let mbPromise: Promise<MediabunnyModule> | null = null;

export function ensureMediabunny(): Promise<MediabunnyModule> {
  mbPromise ??= import("mediabunny");
  return mbPromise;
}
