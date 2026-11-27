import { defineConfig } from "vitest/config";
import { createVitestConfig } from "@brain-bbqs/config/vitest";

export default defineConfig(
  createVitestConfig({
    rootDir: new URL("..", import.meta.url),
    environment: "jsdom",
    // About a point under the suite's figures when these were set (99.95% of statements, 98.63% of
    // branches, 100% of functions and lines), so a refactor that drops a branch or two still passes
    // but a change that leaves real code untested fails `npm run test:coverage` and CI with it.
    thresholds: { statements: 99, branches: 97, functions: 99, lines: 99 },
  }),
);
