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
    },
  }),
);
