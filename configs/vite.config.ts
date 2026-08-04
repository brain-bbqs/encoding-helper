import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { resolveAppVersion } from "./appVersion";

const rootDir = fileURLToPath(new URL("..", import.meta.url));

export default defineConfig({
  root: rootDir,
  base: "./",
  define: {
    __APP_VERSION__: JSON.stringify(resolveAppVersion()),
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // ffmpeg.wasm/mediabunny/mp4box are already lazy-loaded on demand within
    // the app; keep them as separate chunks so the initial page load stays small.
    // Vite's bundler here (rolldown) only accepts a function for manualChunks, not the
    // classic Rollup object-map shorthand.
    rollupOptions: {
      output: {
        manualChunks(id: string): string | undefined {
          if (id.includes("node_modules/mediabunny")) return "mediabunny";
          if (id.includes("node_modules/mp4box")) return "mp4box";
          if (id.includes("node_modules/@ffmpeg")) return "ffmpeg";
          return undefined;
        },
      },
    },
  },
  worker: {
    format: "es",
  },
});
