import { describe, expect, it } from "vitest";
import { THEME_KEY } from "../../src/lib/settings";

describe("THEME_KEY", () => {
  it("keeps the storage key visitors' saved theme is already stored under", () => {
    expect(THEME_KEY).toBe("encoding-helper.theme");
  });
});
