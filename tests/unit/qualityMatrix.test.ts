import { describe, expect, it } from "vitest";
import {
  bestReductionCell,
  buildMatrixCombos,
  cliSettings,
  comboKey,
  describeSettings,
  evictBeyondBudget,
  makeMatrixCells,
  MATRIX_PRESETS,
  MATRIX_QUALITIES,
  matrixAxes,
  matrixCliState,
  matrixProgress,
  retainedBytes,
} from "../../src/lib/qualityMatrix";
import type { CliState, MatrixCell, MatrixQuality, X264Preset } from "../../src/lib/types";

const CLI: CliState = {
  quality: "medium",
  crf: 25,
  preset: "superfast",
  keyframeInterval: 1,
  gopOverride: null,
  noBFrames: true,
  pad: true,
  faststart: false,
  audioMode: "copy",
  fps: null,
  scale: 1,
};

/** A finished square of `bytes`, optionally still holding its output. */
function done(quality: MatrixQuality, preset: X264Preset, bytes: number, held = true): MatrixCell {
  const [cell] = makeMatrixCells(buildMatrixCombos([quality], [preset]));
  cell.status = "done";
  cell.bytes = bytes;
  cell.blob = held ? new Blob([new Uint8Array(1)]) : null;
  return cell;
}

describe("buildMatrixCombos", () => {
  it("takes the cartesian product of the two axes", () => {
    const combos = buildMatrixCombos(["high", "low"], ["ultrafast", "fast"]);
    expect(combos.map((c) => c.key)).toEqual(["high:ultrafast", "high:fast", "low:ultrafast", "low:fast"]);
  });

  it("orders rows and columns as the dropdowns do, not as they were ticked", () => {
    const combos = buildMatrixCombos(["low", "lossless"], ["fast", "ultrafast"]);
    expect(combos.map((c) => c.key)).toEqual(["lossless:ultrafast", "lossless:fast", "low:ultrafast", "low:fast"]);
  });

  it("carries each quality's own CRF", () => {
    const combos = buildMatrixCombos(MATRIX_QUALITIES, ["medium"]);
    expect(combos.map((c) => c.crf)).toEqual([0, 18, 25, 32]);
  });

  it("is empty when either axis is", () => {
    expect(buildMatrixCombos([], MATRIX_PRESETS)).toEqual([]);
    expect(buildMatrixCombos(MATRIX_QUALITIES, [])).toEqual([]);
  });

  // Resolution is the sweep's, not an axis of it: every square is encoded at the one value.
  it("stamps the sweep's resolution on every combination", () => {
    const combos = buildMatrixCombos(MATRIX_QUALITIES, ["fast", "medium"], 0.5);
    expect(combos.every((c) => c.scale === 0.5)).toBe(true);
  });

  it("is at the source's resolution unless told otherwise", () => {
    expect(buildMatrixCombos(["high"], ["fast"])[0].scale).toBe(1);
  });
});

describe("matrixCliState", () => {
  it("overrides only the two swept fields", () => {
    const [combo] = buildMatrixCombos(["low"], ["veryslow"]);
    const state = matrixCliState(CLI, combo);
    expect(state.quality).toBe("low");
    expect(state.crf).toBe(32);
    expect(state.preset).toBe("veryslow");
    expect(state.scale).toBe(CLI.scale);
    expect(state.keyframeInterval).toBe(CLI.keyframeInterval);
    expect(state.audioMode).toBe(CLI.audioMode);
  });
});

describe("cliSettings", () => {
  it("resolves a named quality to its CRF", () => {
    expect(cliSettings(CLI)).toEqual({ quality: "medium", crf: 25, preset: "superfast", scale: 1 });
  });

  it("keeps the typed-in CRF when the quality is custom", () => {
    expect(cliSettings({ ...CLI, quality: "custom", crf: 41 }).crf).toBe(41);
  });

  it("carries the resolution the encode would be made at", () => {
    expect(cliSettings({ ...CLI, scale: 0.25 }).scale).toBe(0.25);
  });
});

describe("describeSettings", () => {
  it("names the quality, its CRF and the preset", () => {
    expect(describeSettings({ quality: "high", crf: 18, preset: "veryfast", scale: 1 })).toBe(
      "high (CRF 18), veryfast",
    );
  });

  it("adds the resolution only when it is not the source's", () => {
    expect(describeSettings({ quality: "high", crf: 18, preset: "veryfast", scale: 0.5 })).toBe(
      "high (CRF 18), veryfast, 50%",
    );
  });
});

describe("matrixAxes", () => {
  it("reports the axes the cells cover, in dropdown order", () => {
    const cells = makeMatrixCells(buildMatrixCombos(["low", "high"], ["fast", "ultrafast"]));
    expect(matrixAxes(cells)).toEqual({ qualities: ["high", "low"], presets: ["ultrafast", "fast"] });
  });
});

describe("bestReductionCell", () => {
  it("is null before anything has finished", () => {
    expect(bestReductionCell(makeMatrixCells(buildMatrixCombos(["high"], ["fast"])))).toBeNull();
  });

  it("picks the smallest encode", () => {
    const cells = [done("high", "fast", 900), done("low", "fast", 400), done("medium", "fast", 600)];
    expect(bestReductionCell(cells)!.combo.key).toBe(comboKey("low", "fast"));
  });

  it("ignores squares that failed or never ran", () => {
    const failed = done("low", "fast", 10);
    failed.status = "failed";
    const cells = [failed, done("high", "fast", 900)];
    expect(bestReductionCell(cells)!.combo.key).toBe(comboKey("high", "fast"));
  });

  it("breaks a tie towards the better picture, then the faster preset", () => {
    const cells = [done("low", "fast", 500), done("high", "veryfast", 500), done("high", "ultrafast", 500)];
    expect(bestReductionCell(cells)!.combo.key).toBe(comboKey("high", "ultrafast"));
  });
});

describe("evictBeyondBudget", () => {
  it("leaves everything held while the total is inside the budget", () => {
    const cells = [done("high", "fast", 100), done("low", "fast", 200)];
    expect(evictBeyondBudget(cells, 1000)).toEqual([]);
    expect(retainedBytes(cells)).toBe(300);
  });

  it("drops the largest outputs first, and only as many as it must", () => {
    const cells = [done("lossless", "fast", 900), done("high", "fast", 300), done("low", "fast", 100)];
    expect(evictBeyondBudget(cells, 500)).toEqual([comboKey("lossless", "fast")]);
    expect(cells[0].blob).toBeNull();
    expect(cells[1].blob).not.toBeNull();
    // The measurement survives the output being released, so the table still reports it.
    expect(cells[0].bytes).toBe(900);
    expect(retainedBytes(cells)).toBe(400);
  });

  it("spares the square showing in the A/B window", () => {
    const cells = [done("lossless", "fast", 900), done("high", "fast", 300)];
    expect(evictBeyondBudget(cells, 500, comboKey("lossless", "fast"))).toEqual([comboKey("high", "fast")]);
    expect(cells[0].blob).not.toBeNull();
  });
});

describe("matrixProgress", () => {
  it("counts what the sweep has and has not got through", () => {
    const cells = makeMatrixCells(buildMatrixCombos(["high", "low"], ["ultrafast", "fast"]));
    cells[0].status = "done";
    cells[1].status = "failed";
    cells[2].status = "skipped";
    expect(matrixProgress(cells)).toEqual({ total: 4, finished: 3, done: 1, failed: 1, skipped: 1 });
  });
});
