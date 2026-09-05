import { beforeEach, describe, expect, it } from "vitest";
import { attachSyncedZoomPan, ZOOM_MAX, ZOOM_MIN } from "../../src/ui/zoomPan";

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
  return rigWithOnChange(document.createElement("div"), undefined, stageLeft, stageTop);
}

/** The same rig, with a scale listener attached. */
function rigWithOnChange(
  stage: HTMLDivElement,
  onChange?: (scale: number) => void,
  stageLeft = 100,
  stageTop = 50,
): Rig {
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
  return { stage, canvases, zoomPan: attachSyncedZoomPan(stage, canvases, grids, onChange) };
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

/** The grid overlay beside each pane's canvas. */
function gridsOf(stage: HTMLDivElement): HTMLDivElement[] {
  return Array.from(stage.children).map((pane) => pane.children[1] as HTMLDivElement);
}

function drag(stage: HTMLDivElement, from: [number, number], to: [number, number]): void {
  stage.dispatchEvent(new MouseEvent("mousedown", { clientX: from[0], clientY: from[1], bubbles: true }));
  window.dispatchEvent(new MouseEvent("mousemove", { clientX: to[0], clientY: to[1] }));
  window.dispatchEvent(new MouseEvent("mouseup"));
}

/** A touch event carrying `points`, which is all this module reads off one. */
function touch(target: EventTarget, type: string, points: [number, number][]): void {
  const event = new Event(type, { bubbles: true });
  Object.defineProperty(event, "touches", {
    value: points.map(([clientX, clientY]) => ({ clientX, clientY })),
  });
  target.dispatchEvent(event);
}

describe("attachSyncedZoomPan dragging", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("moves the content with the pointer, in every pane at once", () => {
    const { stage, zoomPan, canvases } = rig();
    drag(stage, [200, 150], [230, 130]);
    expect(zoomPan.state).toMatchObject({ tx: 30, ty: -20 });
    expect(canvases[1].style.transform).toBe(canvases[0].style.transform);
  });

  it("stops moving once the button is released", () => {
    const { stage, zoomPan } = rig();
    drag(stage, [200, 150], [230, 150]);
    window.dispatchEvent(new MouseEvent("mousemove", { clientX: 400, clientY: 150 }));
    expect(zoomPan.state.tx).toBe(30);
  });

  it("drags with one finger, and ignores a two-finger gesture", () => {
    const { stage, zoomPan } = rig();
    touch(stage, "touchstart", [[200, 150]]);
    touch(window, "touchmove", [[240, 150]]);
    expect(zoomPan.state.tx).toBe(40);

    // A second finger is a pinch, which this module does not handle: the pan stops rather than
    // jumping to whichever finger is listed first.
    touch(window, "touchmove", [
      [300, 150],
      [320, 150],
    ]);
    expect(zoomPan.state.tx).toBe(40);
    touch(window, "touchend", []);
    touch(window, "touchmove", [[400, 150]]);
    expect(zoomPan.state.tx).toBe(40);
  });

  it("ignores a two-finger start, so a pinch does not begin a pan", () => {
    const { stage, zoomPan } = rig();
    touch(stage, "touchstart", [
      [200, 150],
      [260, 150],
    ]);
    touch(window, "touchmove", [[240, 150]]);
    expect(zoomPan.state.tx).toBe(0);
  });
});

describe("attachSyncedZoomPan controls", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("holds the middle of the pane in place for a button zoom", () => {
    const { zoomPan } = rig();
    zoomPan.zoomBy(2);
    expect(zoomPan.state.scale).toBe(2);
    // The pane's centre is where it was: (200, 150) stays under (200, 150).
    expect(zoomPan.state).toMatchObject({ tx: -200, ty: -150 });
  });

  it("puts everything back to where it started", () => {
    const { stage, zoomPan } = rig();
    wheel(stage, 260, 170, -1);
    drag(stage, [200, 150], [260, 190]);
    zoomPan.fit();
    expect(zoomPan.state).toEqual({ scale: 1, tx: 0, ty: 0 });
  });

  it("shows one source pixel per CSS pixel at actual size", () => {
    const { zoomPan } = rig();
    zoomPan.actualSize();
    // A 640-wide canvas in a 400-wide pane: 1.6 pane px per source px.
    expect(zoomPan.state.scale).toBe(640 / PANE_W);
  });

  it("stops zooming at the ends of the range", () => {
    const { zoomPan } = rig();
    for (let i = 0; i < 40; i++) zoomPan.zoomBy(2);
    expect(zoomPan.state.scale).toBe(ZOOM_MAX);
    for (let i = 0; i < 40; i++) zoomPan.zoomBy(0.5);
    expect(zoomPan.state.scale).toBe(ZOOM_MIN);
  });

  it("reports the scale to whoever asked to be told", () => {
    const stage = document.createElement("div");
    const seen: number[] = [];
    const { zoomPan } = rigWithOnChange(stage, (scale) => seen.push(scale));
    zoomPan.zoomBy(2);
    expect(seen).toEqual([2]);
  });
});

describe("the pixel grid", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("stays hidden until a source pixel is wide enough to draw a box around", () => {
    const { stage, zoomPan } = rig();
    const [grid] = gridsOf(stage);
    // A 640-wide source in a 400-wide pane starts at 0.625 CSS px per source pixel.
    expect(grid.classList.contains("visible")).toBe(false);

    zoomPan.zoomBy(ZOOM_MAX);
    expect(grid.classList.contains("visible")).toBe(true);
    // Sized in raw CSS px rather than by the canvas's own transform, so the hairlines stay thin.
    expect(grid.style.backgroundSize).toBe(`${(PANE_W / 640) * ZOOM_MAX}px ${(PANE_H / 480) * ZOOM_MAX}px`);
    expect(grid.style.backgroundPosition).toBe(`${zoomPan.state.tx}px ${zoomPan.state.ty}px`);
  });

  it("draws the same grid over every pane", () => {
    const { stage, zoomPan } = rig();
    zoomPan.zoomBy(ZOOM_MAX);
    const [first, second] = gridsOf(stage);
    expect(second.style.backgroundSize).toBe(first.style.backgroundSize);
  });
});

/** A canvas with no pane around it: nothing to measure a gesture against. */
function orphanCanvas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 480;
  return canvas;
}

// A canvas the comparison tore out of its pane (a re-render under a stray gesture) has no box to
// anchor on, so the gesture is dropped rather than throwing partway through a transform.
describe("attachSyncedZoomPan without a pane to measure", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("leaves the zoom alone when no pane can be measured", () => {
    const stage = document.createElement("div");
    document.body.append(stage);
    const canvas = orphanCanvas();
    const grid = document.createElement("div");
    const zoomPan = attachSyncedZoomPan(stage, [canvas], [grid]);

    wheel(stage, 200, 150, -1);
    zoomPan.zoomBy(2);
    zoomPan.actualSize();
    expect(zoomPan.state).toEqual({ scale: 1, tx: 0, ty: 0 });

    // A pan needs no pane to measure against, so it still lands on the canvas; only the grid, which
    // is sized from the pane, is left alone.
    drag(stage, [200, 150], [230, 130]);
    expect(canvas.style.transform).toBe("translate(30px, -20px) scale(1)");
    zoomPan.fit();
    expect(canvas.style.transform).toBe("translate(0px, 0px) scale(1)");
    expect(grid.classList.contains("visible")).toBe(false);
    expect(grid.style.backgroundSize).toBe("");
  });

  it("anchors on a pane that is still there when the first has gone", () => {
    const stage = document.createElement("div");
    const pane = document.createElement("div");
    pane.getBoundingClientRect = () =>
      ({ left: 100, top: 50, right: 100 + PANE_W, bottom: 50 + PANE_H, width: PANE_W, height: PANE_H }) as DOMRect;
    const inPane = orphanCanvas();
    pane.append(inPane);
    stage.append(pane);
    document.body.append(stage);
    const canvases = [orphanCanvas(), inPane];
    const zoomPan = attachSyncedZoomPan(stage, canvases, [
      document.createElement("div"),
      document.createElement("div"),
    ]);

    const before = contentUnder(zoomPan.state, 100, 260, 170);
    wheel(stage, 260, 170, -1);
    expect(zoomPan.state.scale).toBeGreaterThan(1);
    const after = contentUnder(zoomPan.state, 100, 260, 170);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
    expect(canvases[0].style.transform).toBe(inPane.style.transform);
  });
});
