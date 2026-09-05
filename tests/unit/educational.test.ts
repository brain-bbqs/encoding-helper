// The module reads the URL and localStorage once, at import, so each case imports it fresh.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type EducationalModule = typeof import("../../src/lib/educational");

function setUrl(search: string): void {
  window.history.replaceState({}, "", "/encoding-helper/" + search);
}

/** Loads lib/educational with the URL and stored value the test set. */
async function load(): Promise<EducationalModule> {
  vi.resetModules();
  return import("../../src/lib/educational");
}

beforeEach(() => {
  setUrl("");
  localStorage.clear();
});

afterEach(() => vi.restoreAllMocks());

describe("initial state", () => {
  it("defaults on, since a first-time visitor is who the explainers are for", async () => {
    expect((await load()).isEducationalEnabled()).toBe(true);
  });

  it("restores the stored choice", async () => {
    localStorage.setItem("encoding-helper.educational", "false");
    expect((await load()).isEducationalEnabled()).toBe(false);
  });

  it("lets the URL win over the stored choice, both ways", async () => {
    localStorage.setItem("encoding-helper.educational", "false");
    setUrl("?edu=1");
    expect((await load()).isEducationalEnabled()).toBe(true);
    setUrl("?edu=0");
    expect((await load()).isEducationalEnabled()).toBe(false);
  });

  it("defaults on when localStorage cannot be read at all", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect((await load()).isEducationalEnabled()).toBe(true);
  });
});

describe("setEducationalEnabled", () => {
  it("stores the choice, writes it to the URL and tells its listeners", async () => {
    const { onEducationalChange, isEducationalEnabled, setEducationalEnabled } = await load();
    const seen: boolean[] = [];
    onEducationalChange((on) => seen.push(on));

    setEducationalEnabled(false);

    expect(isEducationalEnabled()).toBe(false);
    expect(seen).toEqual([false]);
    expect(localStorage.getItem("encoding-helper.educational")).toBe("false");
    expect(new URL(window.location.href).searchParams.get("edu")).toBe("0");
  });

  it("does nothing at all when the switch is already where it is being put", async () => {
    const { onEducationalChange, setEducationalEnabled } = await load();
    const seen: boolean[] = [];
    onEducationalChange((on) => seen.push(on));

    setEducationalEnabled(true);

    expect(seen).toEqual([]);
    expect(new URL(window.location.href).searchParams.has("edu")).toBe(false);
  });

  it("still changes the switch when the choice cannot be stored", async () => {
    const { isEducationalEnabled, setEducationalEnabled } = await load();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("full");
    });
    setEducationalEnabled(false);
    expect(isEducationalEnabled()).toBe(false);
  });

  it("replaces rather than pushes, so the back button does not walk the switch", async () => {
    const push = vi.spyOn(window.history, "pushState");
    const { setEducationalEnabled } = await load();
    setEducationalEnabled(false);
    expect(push).not.toHaveBeenCalled();
  });
});
