import { describe, expect, it } from "vitest";
import {
  clearLog,
  engineBox,
  fieldNumber,
  fieldSelect,
  finishFill,
  logConsole,
  logLine,
  progressBar,
  resetProgressFill,
} from "../../src/ui/formControls";

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

  // Most option lists are plain names, where the value and its wording are the same thing.
  it("uses a plain string option as both its value and its wording", () => {
    const field = fieldSelect("etCodec", "Codec", ["h264", ["hevc", "H.265 / HEVC"]], "h264");
    const options = Array.from(field.querySelectorAll("option"));
    expect(options.map((o) => [o.value, o.textContent])).toEqual([
      ["h264", "h264"],
      ["hevc", "H.265 / HEVC"],
    ]);
    expect(field.querySelector("select")!.value).toBe("h264");
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

  // A console can be handed over on its own, without the fold that normally holds it.
  it("logs into and clears a bare console that has no fold around it", () => {
    const log = document.createElement("div");
    logLine(log, "loose line", "warn");
    expect(log.children).toHaveLength(1);
    expect(log.firstElementChild!.className).toBe("l warn");
    clearLog(log);
    expect(log.children).toHaveLength(0);
  });

  it("still shows and hides a fold that carries no line count", () => {
    const wrap = document.createElement("details");
    wrap.className = "log-details";
    wrap.style.display = "none";
    const log = document.createElement("div");
    wrap.append(log);
    logLine(log, "first");
    expect(wrap.style.display).toBe("");
    expect(wrap.querySelector(".log-count")).toBeNull();
    clearLog(log);
    expect(wrap.style.display).toBe("none");
  });
});

describe("fieldNumber", () => {
  it("builds a labelled number input with its range and step", () => {
    const field = fieldNumber("etCrf", "CRF", 23, 0, 51, 1);
    expect(field.querySelector("label")!.textContent).toBe("CRF");
    const input = field.querySelector("input")!;
    expect(input.type).toBe("number");
    expect(input.id).toBe("etCrf");
    expect(input.value).toBe("23");
    expect(input.min).toBe("0");
    expect(input.max).toBe("51");
    expect(input.step).toBe("1");
  });

  it("explains itself from an ⓘ the same way a select does", () => {
    const field = fieldNumber("etCrf", "CRF", "23", 0, 51, 1, "Lower is better.");
    expect(field.querySelector(".field-head .info-btn")!.getAttribute("aria-label")).toBe("About CRF");
  });
});

describe("progress bars", () => {
  it("starts hidden, and comes back empty and not yet done when a run resets it", () => {
    const { wrap, fill } = progressBar();
    expect(wrap.style.display).toBe("none");
    fill.style.width = "60%";
    fill.classList.add("done");

    expect(resetProgressFill(wrap)).toBe(fill);

    expect(wrap.style.display).toBe("block");
    expect(fill.style.width).toBe("0%");
    expect(fill.classList.contains("done")).toBe(false);
  });

  it("fills to the end in the good-outcome colour when the run finishes", () => {
    const { fill } = progressBar();
    finishFill(fill);
    expect(fill.style.width).toBe("100%");
    expect(fill.classList.contains("done")).toBe(true);
  });

  // A bar with no fill in it can still be shown; there is just nothing to advance, so the run gets
  // null back and finishing it is a no-op rather than an error. Not throwing is the behaviour here.
  it("shows a bar that has no fill, and finishes it without complaint", () => {
    const bare = document.createElement("div");
    const fill = resetProgressFill(bare);
    expect(fill).toBeNull();
    expect(bare.style.display).toBe("block");
    expect(() => finishFill(fill)).not.toThrow();
  });
});

describe("engineBox", () => {
  it("assembles the button, bar, note, console and result block in order", () => {
    const box = engineBox("Run test encode");
    expect(box.button.textContent).toBe("Run test encode");
    expect(box.button.type).toBe("button");
    expect(Array.from(box.el.children)).toEqual([
      box.button,
      box.progress,
      box.note,
      box.log.closest(".log-details"),
      box.result,
    ]);
    expect(box.progress.style.display).toBe("none");
    expect(box.note.className).toBe("progress-label");
    // The console is wired to its fold, so logging shows the fold.
    logLine(box.log, "started");
    expect(box.log.closest<HTMLElement>(".log-details")!.style.display).toBe("");
  });
});
