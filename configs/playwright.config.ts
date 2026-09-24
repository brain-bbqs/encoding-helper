import { defineConfig } from "@playwright/test";
import { createPlaywrightConfig } from "@brain-bbqs/config/playwright";
import { fileURLToPath } from "node:url";

export default defineConfig(
  createPlaywrightConfig({
    rootDir: new URL("..", import.meta.url),
    testDir: "../tests/integration",
    // Builds the video both runs load in place of the sample file this app used to ship with; see
    // tests/fixtures/demoVideo.ts. Once per run, before any worker starts.
    globalSetup: fileURLToPath(new URL("../tests/fixtures/globalSetup.ts", import.meta.url)),
  }),
);
