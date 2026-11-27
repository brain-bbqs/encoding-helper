import { installObserverStub, type ObserverStub } from "@brain-bbqs/test-utils/vitest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { box, progressiveFile } from "../fixtures/boxes";
import { ATOM_MAP_READOUT_HINT } from "../../src/lib/explainers";
import { resetState, state } from "../../src/lib/state";
import type { BoxNode } from "../../src/lib/types";
import { renderAtomMap, renderStaticAtomMap } from "../../src/ui/atomsTab";

/** `pairs` moof+mdat fragments, the shape a long recording takes. */
function fragmentedFile(pairs: number): BoxNode[] {
  const boxes: BoxNode[] = [];
  for (let i = 0; i < pairs; i++) {
    boxes.push(box("moof", i * 200, 100), box("mdat", i * 200 + 100, 100));
  }
  return boxes;
}

/** A box nesting `depth` levels deep, one child per level. */
function chain(type: string, depth: number): BoxNode {
  return box(type, 0, 8 * (depth + 1), depth === 0 ? [] : [chain(type, depth - 1)]);
}

/** The map rendered over `boxes`, the way the Inspect tab does it. */
function render(boxes: BoxNode[]): HTMLDivElement {
  state.boxes = boxes;
  const panel = document.createElement("div");
  document.body.append(panel);
  renderAtomMap(panel);
  return panel;
}

function blocks(panel: HTMLElement): HTMLButtonElement[] {
  return Array.from(panel.querySelectorAll<HTMLButtonElement>(".atom-block"));
}

function blockNamed(panel: HTMLElement, label: string): HTMLButtonElement {
  return blocks(panel).find((b) => b.textContent === label)!;
}

function crumbLabels(panel: HTMLElement): (string | null)[] {
  return Array.from(panel.querySelectorAll(".atom-crumbs .crumb")).map((el) => el.textContent);
}

function legendLabels(host: HTMLElement): (string | null)[] {
  return Array.from(host.querySelectorAll(".legend-label")).map((el) => el.textContent);
}

function readout(panel: HTMLElement): string {
  return panel.querySelector(".atom-readout")!.textContent ?? "";
}

describe("renderAtomMap", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    resetState();
  });

  // A non-MP4 container yields no tree; the card still appears, saying why it is empty.
  it("says so when no boxes were parsed", () => {
    const panel = render([]);
    expect(panel.textContent).toContain("No boxes were parsed for this file.");
    expect(panel.querySelector(".atom-map")).toBeNull();
  });

  it("zooms into a block and walks back out along the breadcrumb", () => {
    const panel = render(progressiveFile());
    // Lane by lane: the top level first, then each level of nesting below it.
    expect(blocks(panel).map((b) => b.textContent)).toEqual(["ftyp", "moov", "mdat", "mvhd", "trak", "tkhd"]);

    blockNamed(panel, "moov").click();
    blockNamed(panel, "trak").click();
    expect(crumbLabels(panel)).toEqual(["Whole file", "moov", "trak"]);
    expect(blocks(panel).map((b) => b.textContent)).toEqual(["moov", "trak", "tkhd"]);

    // A crumb pops the path back to the depth it names, not all the way out.
    panel.querySelectorAll<HTMLButtonElement>(".atom-crumbs .crumb")[1].click();
    expect(crumbLabels(panel)).toEqual(["Whole file", "moov"]);
    expect(blocks(panel).map((b) => b.textContent)).toEqual(["moov", "mvhd", "trak", "tkhd"]);

    panel.querySelector<HTMLButtonElement>(".atom-crumbs .crumb")!.click();
    expect(crumbLabels(panel)).toEqual(["Whole file"]);
    expect(blocks(panel).length).toBe(6);
    expect(panel.querySelector(".crumb-range")!.textContent).toBe("6 boxes shown");
  });

  // A zoomed view still draws the ancestors of what was zoomed to, each spanning the whole of it.
  // Clicking one used to push a crumb for the view already on screen, so a file with one video track
  // offered an endless path of traks.
  it("stops zooming at a block that already fills the view", () => {
    const panel = render([box("moov", 0, 900, [box("trak", 8, 800)]), box("mdat", 900, 1_100_000)]);
    blockNamed(panel, "trak").click();
    expect(crumbLabels(panel)).toEqual(["Whole file", "trak"]);

    // Zoomed in, moov and trak both span the view: neither is a way further in, and clicking adds
    // no crumb.
    const filling = Array.from(panel.querySelectorAll<HTMLButtonElement>(".atom-block.filling"));
    expect(filling.map((b) => b.textContent)).toEqual(["moov", "trak"]);
    filling.forEach((b) => b.click());
    expect(crumbLabels(panel)).toEqual(["Whole file", "trak"]);
  });

  it("reads a block's offset and size into the readout while it is hovered or focused", () => {
    const panel = render(progressiveFile());
    expect(readout(panel)).toBe(ATOM_MAP_READOUT_HINT);
    const mdat = blockNamed(panel, "mdat");

    mdat.dispatchEvent(new Event("mouseenter"));
    expect(readout(panel)).toBe("mdat — sample data · offset 2,032 · 95.7 KB (97,968 B)");
    mdat.dispatchEvent(new Event("mouseleave"));
    expect(readout(panel)).toBe(ATOM_MAP_READOUT_HINT);

    // The same numbers reach a keyboard user through focus, and leave with it.
    mdat.dispatchEvent(new Event("focus"));
    expect(readout(panel)).toContain("offset 2,032");
    mdat.dispatchEvent(new Event("blur"));
    expect(readout(panel)).toBe(ATOM_MAP_READOUT_HINT);
  });

  // Past a few thousand rects the rest of the tree is left undrawn rather than drawn unreadably;
  // the map says so, since zooming in is how the rest becomes reachable.
  it("warns when the file nests further than the map draws", () => {
    const panel = render(Array.from({ length: 40 }, () => chain("moov", 104)));
    expect(panel.textContent).toContain("This file nests further than the map draws");
    expect(blocks(panel).length).toBe(4000);
  });

  it("does not warn when everything fits on the map", () => {
    const panel = render(progressiveFile());
    expect(panel.textContent).not.toContain("nests further than the map draws");
  });

  // The legend is a key to what is on the map, so a progressive file gets no row for the fragment
  // index it has none of, nor for the collapsed runs it is far too small to produce.
  it("keys only the families the map actually drew", () => {
    const panel = render(progressiveFile());
    expect(legendLabels(panel)).toEqual(["moov", "mdat", "other"]);
    // A box outside the three families takes the neutral color the "other" row keys.
    expect(blockNamed(panel, "ftyp").classList[1]).toBe("f-other");
  });

  // A fragmented file's boxes are each too narrow to draw, so the map is all collapsed runs, and
  // the legend keys the run block and the fragment-index family they mostly are.
  it("keys the collapsed runs and the fragment index of a fragmented file", () => {
    const panel = render(fragmentedFile(200));
    expect(blocks(panel).every((b) => b.classList.contains("grouped"))).toBe(true);
    expect(legendLabels(panel)).toEqual(["moof", "N boxes"]);
    const descs = Array.from(panel.querySelectorAll(".legend-desc")).map((el) => el.textContent);
    expect(descs).toEqual(["fragment index", "too many to draw, in the color of most of them"]);
    expect(blocks(panel)[0].getAttribute("aria-label")).toContain("2 boxes in 200 B at offset 0, too many to draw");
  });
});

// Whether a label fits depends on the map's real width, which is zero while the Inspect tab is
// hidden, so the labels are re-sized whenever the map's box changes rather than once at draw time.
describe("renderAtomMap label sizing", () => {
  let stub: ObserverStub;

  beforeEach(() => {
    document.body.innerHTML = "";
    resetState();
    stub = installObserverStub("ResizeObserver");
  });

  afterEach(() => {
    stub.restore();
  });

  it("re-sizes the labels when the map is resized, and watches each redraw's map in turn", () => {
    const panel = render(progressiveFile());
    const [observer] = stub.instances;
    const map = panel.querySelector<HTMLElement>(".atom-map")!;
    expect(observer.observed).toEqual([map]);
    // Drawn while hidden: no width, so no label size yet.
    expect(blockNamed(panel, "mdat").classList.contains("wide")).toBe(false);

    Object.defineProperty(map, "clientWidth", { value: 1000, configurable: true });
    observer.fire();
    expect(blockNamed(panel, "mdat").classList.contains("wide")).toBe(true);
    expect(blockNamed(panel, "tkhd").classList.contains("wide")).toBe(true);

    // Narrower again: a sixth of 200px holds a four-letter label only at the small size.
    Object.defineProperty(map, "clientWidth", { value: 200, configurable: true });
    observer.fire();
    expect(blockNamed(panel, "mdat").className).toBe("atom-block f-mdat snug");
    expect(blockNamed(panel, "moov").className).toBe("atom-block f-moov wide");

    // Zooming builds a fresh map; the observer follows it and lets go of the old one.
    blockNamed(panel, "moov").click();
    expect(observer.disconnected).toBe(true);
    expect(stub.instances.length).toBe(2);
    expect(stub.instances[1].observed).toEqual([panel.querySelector(".atom-map")]);
  });
});

describe("renderStaticAtomMap", () => {
  it("draws nothing for a file with no boxes", () => {
    expect(renderStaticAtomMap([], 800)).toBeNull();
  });

  // The document runs no script to measure itself, so the label size is decided once from the
  // width it will be read at: a block gets the small label where only that fits, and none where
  // neither does.
  it("sizes each label to the width the document will be read at", () => {
    const fit = (widthPx: number): string[] =>
      Array.from(renderStaticAtomMap([box("mdat", 0, 100)], widthPx)!.querySelectorAll(".atom-block")).map(
        (el) => el.className,
      );
    expect(fit(200)).toEqual(["atom-block f-mdat wide"]);
    expect(fit(30)).toEqual(["atom-block f-mdat snug"]);
    expect(fit(20)).toEqual(["atom-block f-mdat"]);
  });

  it("keeps each block's detail as a title, with no zoom to offer", () => {
    const wrap = renderStaticAtomMap(progressiveFile(), 800)!;
    const els = Array.from(wrap.querySelectorAll<HTMLElement>(".atom-block"));
    expect(els.map((el) => el.textContent)).toEqual(["ftyp", "moov", "mdat", "mvhd", "trak", "tkhd"]);
    expect(els.map((el) => el.classList[1])).toEqual(["f-other", "f-moov", "f-mdat", "f-moov", "f-moov", "f-moov"]);
    expect(els[1].title).toBe("moov — index · offset 32 · 2.0 KB (2,000 B)");
    expect(wrap.querySelector("button")).toBeNull();
    expect(wrap.querySelector(".atom-crumbs")).toBeNull();
    expect(legendLabels(wrap)).toEqual(["moov", "mdat", "other"]);
  });

  it("collapses a fragmented file's runs into grouped blocks in the document too", () => {
    const wrap = renderStaticAtomMap(fragmentedFile(200), 800)!;
    const grouped = wrap.querySelectorAll<HTMLElement>(".atom-block.grouped");
    expect(grouped.length).toBe(200);
    expect(grouped[0].title).toContain("2 boxes in 200 B at offset 0, too many to draw one by one");
    expect(legendLabels(wrap)).toEqual(["moof", "N boxes"]);
  });
});
