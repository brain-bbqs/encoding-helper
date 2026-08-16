import { describe, expect, it } from "vitest";
import { clearLog, fieldSelect, logConsole, logLine } from "../../src/ui/formControls";

const OPTIONS: [string, string][] = [
  ["superfast", "superfast"],
  ["veryslow", "veryslow"],
];

describe("fieldSelect", () => {
  it("builds a labelled select with the current value chosen", () => {
    const field = fieldSelect("etPreset", "x264 Preset", OPTIONS, "veryslow");
    expect(field.querySelector("label")!.textContent).toBe("x264 Preset");
    const select = field.querySelector("select")!;
    expect(select.id).toBe("etPreset");
    expect(select.value).toBe("veryslow");
  });

  it("leaves the label bare when there is nothing to explain", () => {
    const field = fieldSelect("etPreset", "x264 Preset", OPTIONS, "superfast");
    expect(field.querySelector(".field-head")).toBeNull();
    expect(field.querySelector(".info-btn")).toBeNull();
  });

  it("puts an ⓘ beside the label when given explainer copy", () => {
    const field = fieldSelect("etPreset", "x264 Preset", OPTIONS, "superfast", "<b>Preset</b> sets how hard…");
    const head = field.querySelector(".field-head")!;
    expect(head.querySelector("label")!.textContent).toBe("x264 Preset");
    expect(head.querySelector(".info-btn")!.getAttribute("aria-label")).toBe("About x264 Preset");
    expect(head.querySelector(".info-pop")!.innerHTML).toBe("<b>Preset</b> sets how hard…");
    // The control itself is unchanged by the explainer.
    expect(field.querySelector("select")!.value).toBe("superfast");
  });
});

describe("logConsole", () => {
  it("starts closed and out of sight, with nothing logged into it yet", () => {
    const { wrap, log } = logConsole();
    expect(wrap.open).toBe(false);
    expect(wrap.style.display).toBe("none");
    expect(log.children).toHaveLength(0);
  });

  it("shows the fold on the first line without opening it, and counts the lines", () => {
    const { wrap, log } = logConsole();
    logLine(log, "first");
    expect(wrap.style.display).toBe("");
    // Shown is not opened: the transcript stays folded until it is asked for.
    expect(wrap.open).toBe(false);
    expect(wrap.querySelector(".log-count")!.textContent).toBe("1 line");
    logLine(log, "second", "error");
    expect(wrap.querySelector(".log-count")!.textContent).toBe("2 lines");
  });

  it("puts the fold away again when a fresh run clears it", () => {
    const { wrap, log } = logConsole();
    logLine(log, "from the last run");
    clearLog(log);
    expect(wrap.style.display).toBe("none");
    expect(log.children).toHaveLength(0);
    expect(wrap.querySelector(".log-count")!.textContent).toBe("");
  });

  it("keeps the console to its last 200 lines", () => {
    const { log } = logConsole();
    for (let i = 0; i < 205; i++) logLine(log, `line ${i}`);
    expect(log.children).toHaveLength(200);
    expect(log.lastElementChild!.textContent).toBe("line 204");
  });
});
