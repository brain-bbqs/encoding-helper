import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureMediabunny } from "../../src/lib/mediabunny";

describe("ensureMediabunny", () => {
  afterEach(() => {
    vi.doUnmock("mediabunny");
    vi.resetModules();
  });

  it("loads the module and hands every later caller the same one", async () => {
    const first = ensureMediabunny();
    const second = ensureMediabunny();
    // The same promise, so the module is fetched once however many tabs ask for it.
    expect(second).toBe(first);
    const mb = await first;
    expect(typeof mb.Input).toBe("function");
    expect(await ensureMediabunny()).toBe(mb);
  });

  // The page starts the import as it opens, so a dropped connection then would otherwise fail every
  // file load after it, with the same error, until the page was reloaded.
  it("forgets an import that failed, so the next caller tries again", async () => {
    vi.resetModules();
    let attempts = 0;
    vi.doMock("mediabunny", () => {
      attempts++;
      if (attempts === 1) throw new Error("Failed to fetch dynamically imported module");
      return { Input: class {} };
    });
    const { ensureMediabunny: fresh } = await import("../../src/lib/mediabunny");

    // Whatever it rejects with: vitest wraps a failing mock factory's error in one of its own.
    await expect(fresh()).rejects.toThrow();
    expect(attempts).toBe(1);
    const mb = await fresh();

    expect(typeof mb.Input).toBe("function");
    expect(attempts).toBe(2);
  });
});
