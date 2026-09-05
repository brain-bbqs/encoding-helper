import { beforeEach, describe, expect, it } from "vitest";
import { isEducationalEnabled, setEducationalEnabled } from "../../src/lib/educational";
import { renderEducationalToggle } from "../../src/ui/educationalToggle";

function toggle(): { label: HTMLLabelElement; input: HTMLInputElement } {
  const label = renderEducationalToggle();
  return { label, input: label.querySelector<HTMLInputElement>("input")! };
}

describe("renderEducationalToggle", () => {
  beforeEach(() => setEducationalEnabled(true));

  it("names itself, since the word beside it is dropped on a narrow header", () => {
    const { label, input } = toggle();
    expect(input.getAttribute("aria-label")).toBe("Educational");
    expect(input.type).toBe("checkbox");
    expect(label.textContent).toContain("Educational");
    expect(label.querySelector(".edu-toggle-icon")!.getAttribute("aria-hidden")).toBe("true");
  });

  it("starts where the flag already is", () => {
    expect(toggle().input.checked).toBe(true);
    setEducationalEnabled(false);
    expect(toggle().input.checked).toBe(false);
  });

  it("writes the flag when it is switched", () => {
    const { input } = toggle();
    input.checked = false;
    input.dispatchEvent(new Event("change"));
    expect(isEducationalEnabled()).toBe(false);

    input.checked = true;
    input.dispatchEvent(new Event("change"));
    expect(isEducationalEnabled()).toBe(true);
  });
});
