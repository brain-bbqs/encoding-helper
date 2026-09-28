// @vitest-environment jsdom
// main.ts preloads mediabunny at boot; a failed preload is logged and leaves the page usable.
import { beforeAll, expect, it, vi } from "vitest";
import { bootMain, el } from "./helpers/mainHarness";

const failure = vi.hoisted(() => new Error("chunk failed to load"));

vi.mock("../../src/lib/mediabunny", () => ({ ensureMediabunny: () => Promise.reject(failure) }));

// Kept by hand rather than read off the spy: the warning lands during boot, in beforeAll, and a
// spy's recorded calls are cleared before each test.
const warnings: unknown[][] = [];
vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
  warnings.push(args);
});

beforeAll(async () => {
  await bootMain();
});

it("warns that the preload failed rather than throwing, and still boots the page", async () => {
  await vi.waitFor(() => expect(warnings.length).toBe(1));
  expect(warnings).toEqual([["[encoding-helper] mediabunny preload failed:", failure]]);
  expect(el("version-indicator").textContent).toBe(`v${__APP_VERSION__}`);
});
