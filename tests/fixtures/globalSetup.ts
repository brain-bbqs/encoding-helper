// Playwright global setup: builds the video the integration and Chromatic runs load, once, before
// any worker starts (see tests/fixtures/demoVideo.ts for why it is not a committed file).

import { buildFixtureVideo } from "./demoVideo";

export default function globalSetup(): void {
  buildFixtureVideo();
}
