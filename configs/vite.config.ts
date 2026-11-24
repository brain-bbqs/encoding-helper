import { defineConfig } from "vite";
import { createViteConfig, prePaintPlugin } from "@brain-bbqs/config/vite";
// With the extension: Vite's native config loader (its future default) refuses extensionless
// imports between config files.
import { THEME_KEY } from "../src/lib/settings.ts";

export default defineConfig(
  createViteConfig({
    rootDir: new URL("..", import.meta.url),
    overrides: {
      plugins: [prePaintPlugin({ themeKey: THEME_KEY })],
      build: {
        // Keep ffmpeg.wasm, mediabunny and mp4box as separate chunks. Only mediabunny is
        // behind a dynamic import; the ffmpeg core itself loads from the CDN on demand.
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
    },
  }),
);
