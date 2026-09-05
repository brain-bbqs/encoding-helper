import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { resolveAppVersion } from "./appVersion";

const rootDir = fileURLToPath(new URL("..", import.meta.url));

export default defineConfig({
  root: rootDir,
  // Defined the same way the app is built (see vite.config.ts), so a module that prints the version
  // into what it renders can be unit-tested at all.
  define: {
    __APP_VERSION__: JSON.stringify(resolveAppVersion()),
  },
  test: {
    environment: "jsdom",
    include: ["tests/unit/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.ts"],
      exclude: ["src/main.ts", "src/**/*.d.ts"],
    },
  },
});
