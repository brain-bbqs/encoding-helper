import { beforeEach, describe, expect, it } from "vitest";
import { resetCliDefaults, VIDEO_TRACK } from "../fixtures/state";
import { fmtSizeChangePct } from "../../src/lib/format";
import { cli, state } from "../../src/lib/state";
import {
  bindResolutionControls,
  parseScaler,
  refreshCliCommand,
  resolutionFields,
  scalerOptions,
  showReencodeResult,
  syncQualityControls,
} from "../../src/ui/cliControls";
import { fieldNumber, fieldSelect, type EngineBox } from "../../src/ui/formControls";

/** The resolution controls, in the document since the binding reaches for them by id. */
function renderResolution(): { select: HTMLSelectElement; custom: HTMLInputElement; customField: HTMLDivElement } {
  const { scaleField, customField } = resolutionFields({ width: 640, height: 480 });
  const panel = document.createElement("div");
  panel.append(scaleField, customField);
  document.body.append(panel);
  bindResolutionControls();
  return {
    select: panel.querySelector<HTMLSelectElement>("#cliScale")!,
    custom: panel.querySelector<HTMLInputElement>("#cliScaleCustom")!,
    customField,
  };
}

/** The other builder controls syncQualityControls refreshes, plus the command preview under them. */
function renderQualityControls(): HTMLDivElement {
  const panel = document.createElement("div");
  panel.append(
    fieldSelect("cliQuality", "Quality", ["low", "medium", "custom"], cli.quality),
    fieldNumber("cliCrf", "CRF", cli.crf, 0, 51, 1),
    fieldSelect("cliPreset", "Preset", ["superfast", "medium"], cli.preset),
    fieldSelect("cliScaler", "Scaler", scalerOptions(), cli.scaler),
  );
  const pre = document.createElement("pre");
  pre.id = "cmdPre";
  panel.append(pre);
  document.body.append(panel);
  return panel;
}

function fire(el: HTMLElement, type: "change" | "input"): void {
  el.dispatchEvent(new Event(type, { bubbles: true }));
}

function loadVideo(): void {
  state.tracks = [VIDEO_TRACK];
  state.fps = 30;
  state.format = "MP4";
}

beforeEach(() => {
  document.body.innerHTML = "";
  resetCliDefaults();
  cli.customScale = 60;
});

describe("refreshCliCommand", () => {
  it("leaves the preview alone before a video is loaded", () => {
    state.tracks = [];
    const pre = document.createElement("pre");
    pre.id = "cmdPre";
    pre.textContent = "(none)";
    document.body.append(pre);
    refreshCliCommand();
    expect(pre.textContent).toBe("(none)");
  });

  it("writes the command for the loaded video into the preview", () => {
    loadVideo();
    const pre = document.createElement("pre");
    pre.id = "cmdPre";
    document.body.append(pre);
    refreshCliCommand();
    expect(pre.textContent).toContain("-crf 25");
    expect(pre.textContent).toContain("video-reencoded.mp4");
  });
});

describe("resolutionFields", () => {
  it("offers the ladder against the file's own dimensions, then a custom entry", () => {
    const { select, customField } = renderResolution();
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
      "Source (100%) (640×480)",
      "75% (480×360)",
      "50% (320×240)",
      "25% (160×120)",
      "Custom %",
    ]);
    expect(select.value).toBe("1");
    expect(customField.style.display).toBe("none");
    expect(customField.classList.contains("field-compact")).toBe(true);
  });

  it("shows the custom field, seeded from the scale in play, when the scale is off the ladder", () => {
    cli.scale = 0.33;
    const { select, custom, customField } = renderResolution();
    expect(select.value).toBe("custom");
    expect(custom.value).toBe("33");
    expect(customField.style.display).toBe("");
  });

  it("seeds a hidden custom field from the remembered percentage", () => {
    cli.customScale = 42;
    expect(renderResolution().custom.value).toBe("42");
  });
});

describe("bindResolutionControls", () => {
  it("takes a ladder value from the select and hides the custom field", () => {
    const { select, customField } = renderResolution();
    select.value = "0.5";
    fire(select, "change");
    expect(cli.scale).toBe(0.5);
    expect(customField.style.display).toBe("none");
  });

  // A value that is not on the ladder cannot come from the dropdown itself, so it is treated as the
  // source rather than as some resolution the user never picked.
  it("falls back to the source when the select carries a value off the ladder", () => {
    cli.scale = 0.5;
    const { select } = renderResolution();
    const rogue = document.createElement("option");
    rogue.value = "0.33";
    select.append(rogue);
    select.value = "0.33";
    fire(select, "change");
    expect(cli.scale).toBe(1);
    expect(select.value).toBe("1");
  });

  it("switches to the remembered custom percentage and reveals its field", () => {
    const { select, custom, customField } = renderResolution();
    select.value = "custom";
    fire(select, "change");
    expect(cli.scale).toBe(0.6);
    expect(custom.value).toBe("60");
    expect(customField.style.display).toBe("");
  });

  it("applies a typed custom percentage to the scale and remembers it", () => {
    const { select, custom } = renderResolution();
    custom.value = "37";
    fire(custom, "input");
    expect(cli.customScale).toBe(37);
    expect(cli.scale).toBe(0.37);
    expect(select.value).toBe("custom");
  });

  it("clamps a typed percentage to 1..100", () => {
    const { custom } = renderResolution();
    custom.value = "250";
    fire(custom, "input");
    expect(cli.customScale).toBe(100);
    expect(cli.scale).toBe(1);

    custom.value = "0";
    fire(custom, "input");
    expect(cli.customScale).toBe(1);
    expect(cli.scale).toBe(0.01);
  });

  // Half-typed input is left alone rather than turned into a scale of NaN.
  it("ignores an empty custom field", () => {
    const { custom } = renderResolution();
    cli.scale = 0.5;
    custom.value = "";
    fire(custom, "input");
    expect(cli.customScale).toBe(60);
    expect(cli.scale).toBe(0.5);
  });

  // The builder is on one tab only, so binding on a page without it must simply do nothing; not
  // throwing is the behaviour here.
  it("binds nothing when the fields are not on the page", () => {
    expect(() => bindResolutionControls()).not.toThrow();
  });
});

describe("scaler helpers", () => {
  it("names each kernel by the flag it becomes", () => {
    expect(scalerOptions()).toEqual([
      ["lanczos", "lanczos (sharper)"],
      ["bicubic", "bicubic (softer)"],
    ]);
  });

  it("accepts a known kernel and falls back to the default for anything else", () => {
    expect(parseScaler("bicubic")).toBe("bicubic");
    expect(parseScaler("lanczos")).toBe("lanczos");
    expect(parseScaler("nearest")).toBe("lanczos");
    expect(parseScaler("")).toBe("lanczos");
  });
});

describe("syncQualityControls", () => {
  it("shows the CRF field only for a custom quality", () => {
    loadVideo();
    const panel = renderQualityControls();
    const crf = panel.querySelector<HTMLInputElement>("#cliCrf")!;
    syncQualityControls();
    expect(crf.parentElement!.style.display).toBe("none");

    cli.quality = "custom";
    cli.crf = 18;
    cli.preset = "medium";
    syncQualityControls();
    expect(panel.querySelector<HTMLSelectElement>("#cliQuality")!.value).toBe("custom");
    expect(crf.value).toBe("18");
    expect(crf.parentElement!.style.display).toBe("");
    expect(panel.querySelector<HTMLSelectElement>("#cliPreset")!.value).toBe("medium");
    expect(panel.querySelector("#cmdPre")!.textContent).toContain("-crf 18");
  });

  // The kernel only reaches the command once something is resampled, so at full size the field is
  // there but inert rather than gone.
  it("keeps the kernel field in place but disabled at full resolution", () => {
    loadVideo();
    const panel = renderQualityControls();
    const scaler = panel.querySelector<HTMLSelectElement>("#cliScaler")!;
    syncQualityControls();
    expect(scaler.disabled).toBe(true);

    cli.scale = 0.5;
    cli.scaler = "bicubic";
    syncQualityControls();
    expect(scaler.disabled).toBe(false);
    expect(scaler.value).toBe("bicubic");
    expect(panel.querySelector("#cmdPre")!.textContent).toContain("flags=bicubic");
  });

  it("writes a custom scale back into the resolution controls", () => {
    const { select, custom, customField } = renderResolution();
    cli.scale = 0.8;
    syncQualityControls();
    expect(select.value).toBe("custom");
    expect(custom.value).toBe("80");
    expect(customField.style.display).toBe("");

    cli.scale = 0.25;
    syncQualityControls();
    expect(select.value).toBe("0.25");
    expect(custom.value).toBe("80");
    expect(customField.style.display).toBe("none");
  });

  // On a tab without the builder there is nothing to sync, so not throwing is the behaviour there;
  // once the preview alone is on the page it is still refreshed, whatever controls are missing.
  it("still refreshes the command preview when none of the controls is on the page", () => {
    loadVideo();
    cli.quality = "custom";
    cli.crf = 30;
    expect(() => syncQualityControls()).not.toThrow();

    const pre = document.createElement("pre");
    pre.id = "cmdPre";
    document.body.append(pre);
    syncQualityControls();
    expect(pre.textContent).toContain("-crf 30");
  });
});

describe("showReencodeResult", () => {
  function box(): EngineBox {
    const note = document.createElement("div");
    note.textContent = "Encoding…";
    const result = document.createElement("div");
    result.innerHTML = "<p>old</p>";
    return { note, result } as unknown as EngineBox;
  }

  it("reports the sizes and the change, and records the encode for the analysis document", () => {
    const b = box();
    showReencodeResult(b, 2_000_000, 500_000);
    const vals = Array.from(b.result.querySelectorAll(".val")).map((v) => v.textContent);
    expect(vals).toEqual(["1.9 MB", "488.3 KB", "-75.0% (original 4.0× larger)"]);
    expect(b.note.textContent).toBe("");
    expect(state.reencodeResult).toEqual({ originalSize: 2_000_000, encodedSize: 500_000 });
  });

  it("leaves the factor off when there was no original size to divide by", () => {
    const b = box();
    showReencodeResult(b, 0, 500);
    const change = Array.from(b.result.querySelectorAll(".val")).map((v) => v.textContent)[2];
    expect(change).toBe(fmtSizeChangePct(0, 500));
    expect(change).not.toContain("(");
  });
});
