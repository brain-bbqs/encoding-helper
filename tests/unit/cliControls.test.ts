import { beforeEach, describe, expect, it } from "vitest";
import { resetCliDefaults, VIDEO_TRACK } from "../fixtures/state";
import { fmtSizeChangePct } from "../../src/lib/format";
import { cli, state } from "../../src/lib/state";
import {
  bindResolutionControls,
  parseScaler,
  type QualityControls,
  refreshCliCommand,
  resolutionFields,
  scalerOptions,
  showReencodeResult,
  syncQualityControls,
} from "../../src/ui/cliControls";
import { fieldNumber, fieldSelect, type EngineBox } from "../../src/ui/formControls";

/** The builder's controls that bear on each other and the command preview under them, wired the
 * way renderEncodeTab wires them: the resolution pair bound to one sync over the lot, which is run
 * once straight after building, as the tab does. */
function renderBuilder(): QualityControls & { sync: () => void } {
  const resolution = resolutionFields({ width: 640, height: 480 });
  const quality = fieldSelect("cliQuality", "Quality", ["low", "medium", "custom"], cli.quality);
  const crf = fieldNumber("cliCrf", "CRF", cli.crf, 0, 51, 1);
  const preset = fieldSelect("cliPreset", "Preset", ["superfast", "medium"], cli.preset);
  const scaler = fieldSelect("cliScaler", "Scaler", scalerOptions(), cli.scaler);
  const cmdPre = document.createElement("pre");
  const panel = document.createElement("div");
  panel.append(
    resolution.scaleField,
    resolution.customField,
    quality.field,
    crf.field,
    preset.field,
    scaler.field,
    cmdPre,
  );
  document.body.append(panel);
  const controls: QualityControls = {
    ...resolution,
    qualitySelect: quality.select,
    crfField: crf.field,
    crfInput: crf.input,
    presetSelect: preset.select,
    scalerSelect: scaler.select,
    cmdPre,
  };
  const sync = (): void => syncQualityControls(controls);
  bindResolutionControls(resolution, sync);
  sync();
  return { ...controls, sync };
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
});

describe("refreshCliCommand", () => {
  it("leaves the preview alone before a video is loaded", () => {
    state.tracks = [];
    const pre = document.createElement("pre");
    pre.textContent = "(none)";
    refreshCliCommand(pre);
    expect(pre.textContent).toBe("(none)");
  });

  it("writes the command for the loaded video into the preview", () => {
    loadVideo();
    const pre = document.createElement("pre");
    refreshCliCommand(pre);
    expect(pre.textContent).toContain("-crf 25");
    expect(pre.textContent).toContain("video-reencoded.mp4");
  });
});

describe("resolutionFields", () => {
  it("offers the ladder against the file's own dimensions, then a custom entry", () => {
    const { scaleField, scaleSelect, customField, customInput } = resolutionFields({ width: 640, height: 480 });
    expect(Array.from(scaleSelect.options).map((o) => o.textContent)).toEqual([
      "Source (100%) (640×480)",
      "75% (480×360)",
      "50% (320×240)",
      "25% (160×120)",
      "Custom %",
    ]);
    expect(scaleSelect.value).toBe("1");
    expect(scaleField.querySelector("select")).toBe(scaleSelect);
    expect(customField.querySelector("input")).toBe(customInput);
    expect(customField.classList.contains("field-compact")).toBe(true);
  });

  // Which of the two shows is the sync's call, at build as after every change, so a builder built
  // over a scale on the ladder comes up with the custom field out of sight.
  it("comes up with the custom field hidden while the scale is on the ladder", () => {
    expect(renderBuilder().customField.style.display).toBe("none");
  });

  it("shows the custom field, seeded from the scale in play, when the scale is off the ladder", () => {
    cli.scale = 0.33;
    const { scaleSelect, customInput, customField } = renderBuilder();
    expect(scaleSelect.value).toBe("custom");
    expect(customInput.value).toBe("33");
    expect(customField.style.display).toBe("");
  });

  it("seeds a hidden custom field from the remembered percentage", () => {
    cli.customScale = 42;
    expect(renderBuilder().customInput.value).toBe("42");
  });
});

describe("bindResolutionControls", () => {
  it("takes a ladder value from the select and hides the custom field", () => {
    const { scaleSelect, customField } = renderBuilder();
    scaleSelect.value = "0.5";
    fire(scaleSelect, "change");
    expect(cli.scale).toBe(0.5);
    expect(customField.style.display).toBe("none");
  });

  // A value that is not on the ladder cannot come from the dropdown itself, so it is treated as the
  // source rather than as some resolution the user never picked.
  it("falls back to the source when the select carries a value off the ladder", () => {
    cli.scale = 0.5;
    const { scaleSelect } = renderBuilder();
    const rogue = document.createElement("option");
    rogue.value = "0.33";
    scaleSelect.append(rogue);
    scaleSelect.value = "0.33";
    fire(scaleSelect, "change");
    expect(cli.scale).toBe(1);
    expect(scaleSelect.value).toBe("1");
  });

  it("switches to the remembered custom percentage and reveals its field", () => {
    const { scaleSelect, customInput, customField } = renderBuilder();
    scaleSelect.value = "custom";
    fire(scaleSelect, "change");
    expect(cli.scale).toBe(0.6);
    expect(customInput.value).toBe("60");
    expect(customField.style.display).toBe("");
  });

  it("applies a typed custom percentage to the scale and remembers it", () => {
    const { scaleSelect, customInput } = renderBuilder();
    customInput.value = "37";
    fire(customInput, "input");
    expect(cli.customScale).toBe(37);
    expect(cli.scale).toBe(0.37);
    expect(scaleSelect.value).toBe("custom");
  });

  it("clamps a typed percentage to 1..100", () => {
    const { customInput } = renderBuilder();
    customInput.value = "250";
    fire(customInput, "input");
    expect(cli.customScale).toBe(100);
    expect(cli.scale).toBe(1);

    customInput.value = "0";
    fire(customInput, "input");
    expect(cli.customScale).toBe(1);
    expect(cli.scale).toBe(0.01);
  });

  // Half-typed input is left alone rather than turned into a scale of NaN.
  it("ignores an empty custom field", () => {
    const { customInput } = renderBuilder();
    cli.scale = 0.5;
    customInput.value = "";
    fire(customInput, "input");
    expect(cli.customScale).toBe(60);
    expect(cli.scale).toBe(0.5);
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
    const b = renderBuilder();
    expect(b.crfField.style.display).toBe("none");

    cli.quality = "custom";
    cli.crf = 18;
    cli.preset = "medium";
    b.sync();
    expect(b.qualitySelect.value).toBe("custom");
    expect(b.crfInput.value).toBe("18");
    expect(b.crfField.style.display).toBe("");
    expect(b.presetSelect.value).toBe("medium");
    expect(b.cmdPre.textContent).toContain("-crf 18");
  });

  // The kernel only reaches the command once something is resampled, so at full size the field is
  // there but inert rather than gone.
  it("keeps the kernel field in place but disabled at full resolution", () => {
    loadVideo();
    const b = renderBuilder();
    expect(b.scalerSelect.disabled).toBe(true);

    cli.scale = 0.5;
    cli.scaler = "bicubic";
    b.sync();
    expect(b.scalerSelect.disabled).toBe(false);
    expect(b.scalerSelect.value).toBe("bicubic");
    expect(b.cmdPre.textContent).toContain("flags=bicubic");
  });

  it("writes a custom scale back into the resolution controls", () => {
    const b = renderBuilder();
    cli.scale = 0.8;
    b.sync();
    expect(b.scaleSelect.value).toBe("custom");
    expect(b.customInput.value).toBe("80");
    expect(b.customField.style.display).toBe("");

    cli.scale = 0.25;
    b.sync();
    expect(b.scaleSelect.value).toBe("0.25");
    expect(b.customInput.value).toBe("80");
    expect(b.customField.style.display).toBe("none");
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
