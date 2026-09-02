// Synchronized zoom & pan for the Compare Quality panes: one gesture drives every pane at once.

import type { ZoomPanState } from "../lib/types";

// Shared drag state: a single pair of window-level listeners serves every comparison run rather than
// accumulating one pair per re-render.
interface ZoomDrag {
  lastX: number;
  lastY: number;
  zoom: ZoomPanState;
  apply: () => void;
}
let activeZoomDrag: ZoomDrag | null = null;
window.addEventListener("mousemove", (e) => {
  if (!activeZoomDrag) return;
  const d = activeZoomDrag;
  d.zoom.tx += e.clientX - d.lastX;
  d.zoom.ty += e.clientY - d.lastY;
  d.lastX = e.clientX;
  d.lastY = e.clientY;
  d.apply();
});
window.addEventListener("mouseup", () => {
  activeZoomDrag = null;
});
window.addEventListener(
  "touchmove",
  (e) => {
    if (!activeZoomDrag || e.touches.length !== 1) return;
    const d = activeZoomDrag;
    d.zoom.tx += e.touches[0].clientX - d.lastX;
    d.zoom.ty += e.touches[0].clientY - d.lastY;
    d.lastX = e.touches[0].clientX;
    d.lastY = e.touches[0].clientY;
    d.apply();
  },
  { passive: true },
);
window.addEventListener("touchend", () => {
  activeZoomDrag = null;
});

// Pixel grid appears once a source pixel renders at least this many CSS px wide.
const PIXEL_GRID_THRESHOLD = 8;

export const ZOOM_MIN = 0.2;
export const ZOOM_MAX = 50;
/** One button press covers several wheel notches, so clicking through the range stays quick. */
export const ZOOM_BUTTON_STEP = 1.5;
/** Per wheel notch; small enough that a fast scroll still lands near where the user aimed. */
const ZOOM_WHEEL_STEP = 1.15;

export function attachSyncedZoomPan(
  stageEl: HTMLDivElement,
  canvases: HTMLCanvasElement[],
  grids: HTMLDivElement[],
  onChange?: (scale: number) => void,
) {
  const zoom: ZoomPanState = { scale: 1, tx: 0, ty: 0 };

  // The pane is the untransformed reference box: only the canvas inside it carries the transform,
  // so every anchor and grid measurement below is taken against the pane, never the canvas.
  const paneOf = (canvas: HTMLCanvasElement): HTMLElement | null => canvas.parentElement;

  // The grid overlay is deliberately NOT css-transformed like the canvas — background-size/position
  // are computed fresh in raw CSS px on every change instead, so its hairlines stay a crisp 1
  // screen-px wide at any zoom level rather than fattening along with the content.
  const updateGrids = (): void => {
    canvases.forEach((canvas, i) => {
      const grid = grids[i];
      const paneRect = paneOf(canvas)?.getBoundingClientRect();
      if (!paneRect) return;
      const pxW = (paneRect.width / canvas.width) * zoom.scale;
      const pxH = (paneRect.height / canvas.height) * zoom.scale;
      const visible = pxW >= PIXEL_GRID_THRESHOLD && pxH >= PIXEL_GRID_THRESHOLD;
      grid.classList.toggle("visible", visible);
      if (visible) {
        grid.style.backgroundSize = `${pxW}px ${pxH}px`;
        grid.style.backgroundPosition = `${zoom.tx}px ${zoom.ty}px`;
      }
    });
  };

  const apply = (): void => {
    const t = `translate(${zoom.tx}px, ${zoom.ty}px) scale(${zoom.scale})`;
    canvases.forEach((c) => {
      c.style.transform = t;
    });
    updateGrids();
    onChange?.(zoom.scale);
  };

  const setScale = (newScale: number, anchorX: number, anchorY: number): void => {
    const clamped = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, newScale));
    zoom.tx = anchorX - (anchorX - zoom.tx) * (clamped / zoom.scale);
    zoom.ty = anchorY - (anchorY - zoom.ty) * (clamped / zoom.scale);
    zoom.scale = clamped;
    apply();
  };

  // Where the pointer sits within the pane, in the same untransformed pane px that `tx`/`ty` use.
  // The panes are kept in sync, so whichever one the pointer is over is an equally good reference;
  // a pointer in the gap between them falls back to the first.
  const anchorAt = (clientX: number, clientY: number): { x: number; y: number } | null => {
    const rects = canvases.map((c) => paneOf(c)?.getBoundingClientRect() ?? null);
    const hit =
      rects.find((r) => r && clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) ??
      rects[0];
    if (!hit) return null;
    return { x: clientX - hit.left, y: clientY - hit.top };
  };

  stageEl.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const anchor = anchorAt(e.clientX, e.clientY);
      if (!anchor) return;
      const factor = e.deltaY < 0 ? ZOOM_WHEEL_STEP : 1 / ZOOM_WHEEL_STEP;
      setScale(zoom.scale * factor, anchor.x, anchor.y);
    },
    { passive: false },
  );
  stageEl.addEventListener("mousedown", (e) => {
    activeZoomDrag = { lastX: e.clientX, lastY: e.clientY, zoom, apply };
  });
  stageEl.addEventListener(
    "touchstart",
    (e) => {
      if (e.touches.length === 1)
        activeZoomDrag = { lastX: e.touches[0].clientX, lastY: e.touches[0].clientY, zoom, apply };
    },
    { passive: true },
  );

  return {
    state: zoom,
    /** Button-driven zoom: no cursor to aim at, so it holds the middle of the pane in place. */
    zoomBy: (factor: number): void => {
      const paneRect = paneOf(canvases[0])?.getBoundingClientRect();
      if (!paneRect) return;
      setScale(zoom.scale * factor, paneRect.width / 2, paneRect.height / 2);
    },
    fit: (): void => {
      zoom.scale = 1;
      zoom.tx = 0;
      zoom.ty = 0;
      apply();
    },
    // 1 source pixel = 1 CSS px, centered on whatever's currently in the middle of the pane.
    actualSize: (): void => {
      const paneRect = paneOf(canvases[0])?.getBoundingClientRect();
      if (!paneRect) return;
      const newScale = canvases[0].width / paneRect.width;
      setScale(newScale, paneRect.width / 2, paneRect.height / 2);
    },
  };
}
