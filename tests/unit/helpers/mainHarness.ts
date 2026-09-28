// Boots the real src/main.ts against the real index.html, one test file per boot scenario (a file's
// module registry runs main.ts's top-level wiring once). The import stays here, in the app's own
// code, so Vitest transforms it and a test file's vi.mock calls apply to what main.ts imports.
import { createMainHarness } from "@brain-bbqs/test-utils/vitest";

export const { bootMain } = createMainHarness({ importMain: () => import("../../../src/main") });
export { el } from "@brain-bbqs/test-utils/vitest";
