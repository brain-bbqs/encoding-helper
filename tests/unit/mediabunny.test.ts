import { describe, expect, it } from "vitest";
import { ensureMediabunny } from "../../src/lib/mediabunny";

describe("ensureMediabunny", () => {
  it("loads the module and hands every later caller the same one", async () => {
    const first = ensureMediabunny();
    const second = ensureMediabunny();
    // The same promise, so the module is fetched once however many tabs ask for it.
    expect(second).toBe(first);
    const mb = await first;
    expect(typeof mb.Input).toBe("function");
    expect(await ensureMediabunny()).toBe(mb);
  });
});
