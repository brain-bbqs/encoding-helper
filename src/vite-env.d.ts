/// <reference types="vite/client" />

// Injected at build time by `define` in configs/vite.config.ts (and configs/storybook/main.ts)
// from the version in package.json, via `resolveAppVersion` in @brain-bbqs/config.
declare const __APP_VERSION__: string;
