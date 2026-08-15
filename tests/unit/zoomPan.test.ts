import { beforeEach, describe, expect, it } from "vitest";
import { attachSyncedZoomPan } from "../../src/ui/zoomPan";

const PANE_W = 400;
const PANE_H = 300;
const GAP = 8;

interface Rig {
  stage: HTMLDivElement;
  canvases: HTMLCanvasElement[];
  zoomPan: ReturnType<typeof attachSyncedZoomPan>;
}

/** Two side-by-side panes at fixed screen positions; jsdom has no layout, so rects are stubbed. */
function rig(stageLeft = 100, stageTop = 50): Rig {
  const stage = document.createElement("div");
  const canvases: HTMLCanvasElement[] = [];
  const grids: HTMLDivElement[] = [];
  [0, 1].forEach((i) => {
    const pane = document.createElement("div");
    const left = stageLeft + i * (PANE_W + GAP);
    pane.getBoundingClientRect = () =>
      ({
        left,
        top: stageTop,
        right: left + PANE_W,
        bottom: stageTop + PANE_H,
        width: PANE_W,
        height: PANE_H,
      }) as DOMRect;
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 480;
    const grid = document.createElement("div");
    pane.append(canvas, grid);
    stage.append(pane);
    canvases.push(canvas);
    grids.push(grid);
  });
  document.body.append(stage);
  return { stage, canvases, zoomPan: attachSyncedZoomPan(stage, canvases, grids) };
}

function wheel(stage: HTMLDivElement, clientX: number, clientY: number, deltaY: number): void {
  stage.dispatchEvent(new WheelEvent("wheel", { clientX, clientY, deltaY, bubbles: true, cancelable: true }));
}

/**
 * Content coordinate (in untransformed pane px) currently rendered under a screen point, given the
 * `translate(tx, ty) scale(s)` the canvas carries with `transform-origin: 0 0`.
 */
function contentUnder(
  zoom: { scale: number; tx: number; ty: number },
  paneLeft: number,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  return {
    x: (clientX - paneLeft - zoom.tx) / zoom.scale,
    y: (clientY - 50 - zoom.ty) / zoom.scale,
  };
}

describe("attachSyncedZoomPan wheel zoom", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("keeps the point under the cursor fixed on the first wheel notch", () => {
    const { stage, zoomPan } = rig();
    const before = contentUnder(zoomPan.state, 100, 260, 170);
    wheel(stage, 260, 170, -1);
    expect(zoomPan.state.scale).toBeGreaterThan(1);
    const after = contentUnder(zoomPan.state, 100, 260, 170);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it("keeps the point under the cursor fixed after zooming and panning first", () => {
    const { stage, zoomPan } = rig();
    // Get into a state where both the scale and the translation are non-trivial: the old anchor
    // measured against the transformed canvas only happened to be right at tx = ty = 0.
    wheel(stage, 200, 120, -1);
    wheel(stage, 200, 120, -1);
    zoomPan.state.tx -= 37;
    zoomPan.state.ty += 21;

    const before = contentUnder(zoomPan.state, 100, 300, 200);
    wheel(stage, 300, 200, -1);
    const after = contentUnder(zoomPan.state, 100, 300, 200);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it("anchors on the pane the cursor is over, not always the first one", () => {
    const { stage, zoomPan } = rig();
    const secondPaneLeft = 100 + PANE_W + GAP;
    const cursorX = secondPaneLeft + 90;
    const before = contentUnder(zoomPan.state, secondPaneLeft, cursorX, 200);
    wheel(stage, cursorX, 200, -1);
    const after = contentUnder(zoomPan.state, secondPaneLeft, cursorX, 200);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it("zooms out on a positive wheel delta and holds the cursor point", () => {
    const { stage, zoomPan } = rig();
    wheel(stage, 200, 120, -1);
    wheel(stage, 200, 120, -1);
    const before = contentUnder(zoomPan.state, 100, 340, 240);
    const scaleBefore = zoomPan.state.scale;
    wheel(stage, 340, 240, 1);
    expect(zoomPan.state.scale).toBeLessThan(scaleBefore);
    const after = contentUnder(zoomPan.state, 100, 340, 240);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it("applies the same transform to every pane", () => {
    const { stage, canvases } = rig();
    wheel(stage, 260, 170, -1);
    expect(canvases[1].style.transform).toBe(canvases[0].style.transform);
  });
});
