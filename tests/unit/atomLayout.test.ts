import { describe, expect, it } from "vitest";
import {
  countAtoms,
  layoutAtoms,
  MIN_RECT_WIDTH,
  placeAtoms,
  placementRange,
  type AtomScale,
} from "../../src/lib/atomLayout";
import type { BoxNode } from "../../src/lib/types";

function box(type: string, start: number, size: number, children: BoxNode[] = []): BoxNode {
  return { type, start, size, hdrSize: 8, children };
}

/** A plain, unfragmented file: ftyp, then a moov holding one trak, then the sample payload. */
function progressiveFile(): BoxNode[] {
  return [
    box("ftyp", 0, 32),
    box("moov", 32, 2000, [box("mvhd", 40, 108), box("trak", 148, 1800, [box("tkhd", 156, 92)])]),
    box("mdat", 2032, 97968),
  ];
}

/** `pairs` moof+mdat fragments, the shape a long recording actually takes. */
function fragmentedFile(pairs: number, fragmentSize: number): BoxNode[] {
  const boxes: BoxNode[] = [];
  for (let i = 0; i < pairs; i++) {
    const at = i * fragmentSize;
    boxes.push(box("moof", at, 200, [box("mfhd", at + 8, 16)]));
    boxes.push(box("mdat", at + 200, fragmentSize - 200));
  }
  return boxes;
}

/** Lays a whole file out on one axis, the way the tab does before any zooming. */
function layOut(boxes: BoxNode[], scale: AtomScale) {
  const placements = placeAtoms(boxes, scale);
  return layoutAtoms(placements, placementRange(placements));
}

function drawnTypes(boxes: BoxNode[], scale: AtomScale): (string | undefined)[] {
  return layOut(boxes, scale)
    .rects.filter((r) => r.kind === "box")
    .map((r) => r.box?.type);
}

describe("countAtoms", () => {
  it("counts the box itself plus every descendant", () => {
    expect(countAtoms(progressiveFile()[1])).toBe(4);
    expect(countAtoms(box("mdat", 0, 10))).toBe(1);
  });
});

describe("placeAtoms", () => {
  it("gives each box its own byte range on the byte axis", () => {
    const [ftyp, moov] = placeAtoms(progressiveFile(), "bytes");
    expect(ftyp).toMatchObject({ from: 0, to: 32 });
    expect(moov).toMatchObject({ from: 32, to: 2032 });
    expect(moov.children[1]).toMatchObject({ from: 148, to: 1948 });
  });

  it("splits the structure axis between siblings by how many boxes each subtree holds", () => {
    // Six atoms: ftyp and mdat take one slot each, and moov's subtree takes the other four.
    const [ftyp, moov, mdat] = placeAtoms(progressiveFile(), "structure");
    expect(placementRange(placeAtoms(progressiveFile(), "structure"))).toEqual({ start: 0, end: 6 });
    expect(ftyp).toMatchObject({ from: 0, to: 1 });
    expect(moov).toMatchObject({ from: 1, to: 5 });
    expect(mdat).toMatchObject({ from: 5, to: 6 });
    // mvhd is one atom of the three under moov; trak's subtree is the other two.
    expect(moov.children[0]).toMatchObject({ from: 1, to: 1 + 4 / 3 });
    expect(moov.children[1].children[0]).toMatchObject({ to: 5 });
  });

  it("keeps children inside their parent on both axes", () => {
    for (const scale of ["bytes", "structure"] as const) {
      const [, moov] = placeAtoms(progressiveFile(), scale);
      for (const child of moov.children) {
        expect(child.from).toBeGreaterThanOrEqual(moov.from);
        expect(child.to).toBeLessThanOrEqual(moov.to);
      }
    }
  });
});

describe("layoutAtoms, byte axis", () => {
  it("places each box across the bytes it occupies, as a fraction of the visible range", () => {
    const { rects, laneCount } = layOut(progressiveFile(), "bytes");
    const mdat = rects.find((r) => r.box?.type === "mdat");
    expect(mdat?.x).toBeCloseTo(0.02032);
    expect(mdat?.w).toBeCloseTo(0.97968);
    expect(drawnTypes(progressiveFile(), "bytes")).toEqual(["ftyp", "moov", "trak", "mdat"]);
    expect(laneCount).toBe(3);
  });

  it("keeps every top-level box of a progressive file, however thin ftyp and moov come out", () => {
    // 32 B of ftyp in a 4 GB file rounds to nothing, but where moov sits relative to mdat is the
    // whole point of the byte view, so neither is allowed to collapse away.
    const boxes = [box("ftyp", 0, 32), box("moov", 32, 2000), box("mdat", 2032, 4e9)];
    expect(drawnTypes(boxes, "bytes")).toEqual(["ftyp", "moov", "mdat"]);
  });

  it("puts children in the lane below their parent", () => {
    const { rects } = layOut(progressiveFile(), "bytes");
    expect(rects.find((r) => r.box?.type === "moov")?.depth).toBe(0);
    expect(rects.find((r) => r.box?.type === "trak")?.depth).toBe(1);
  });

  it("labels every descendant with the top-level box it belongs to", () => {
    const { rects } = layOut(progressiveFile(), "bytes");
    expect(rects.find((r) => r.box?.type === "trak")?.family).toBe("moov");
    expect(rects.find((r) => r.box?.type === "mdat")?.family).toBe("mdat");
  });

  it("collapses a run of too-narrow neighbours into one group covering the bytes they span", () => {
    // mvhd (108 B of 100 kB) is too narrow to draw, and stands alone before trak, which is not.
    const groups = layOut(progressiveFile(), "bytes").rects.filter((r) => r.kind === "group" && r.depth === 1);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ byteStart: 40, byteEnd: 148, count: 1, box: null, family: "moov" });
  });

  it("sums a box too narrow to open up into one block on the lane below it", () => {
    // moov is well under 1% of a 4 GB file, so descending into it would draw lane after lane of
    // identical slivers; the whole subtree becomes a single block that zooming opens instead.
    const boxes = [box("moov", 0, 2000, [box("trak", 8, 1900, [box("tkhd", 16, 92)])]), box("mdat", 2000, 4e9)];
    const { rects, laneCount } = layOut(boxes, "bytes");
    expect(laneCount).toBe(2);
    expect(drawnTypes(boxes, "bytes")).toEqual(["moov", "mdat"]);
    expect(rects.find((r) => r.kind === "group")).toMatchObject({ depth: 1, byteStart: 8, byteEnd: 1908, count: 2 });
  });

  it("reports a group's byte range even though it is placed on the axis", () => {
    const group = layOut(fragmentedFile(2000, 100000), "bytes").rects[0];
    expect(group.kind).toBe("group");
    // Each fragment is a moof (with its own mfhd) plus an mdat, and the run is cut once it is wide
    // enough to draw: ten fragments' worth of the file, thirty atoms, one block.
    expect(group.count).toBe(30);
    expect(group).toMatchObject({ byteStart: 0, byteEnd: 1000000 });
  });

  it("cuts a collapsed run once it is wide enough to draw, so the map striates", () => {
    // Every atom of a heavily fragmented file is too narrow to draw. Merged into a single run they
    // would be one block spanning the whole map, which says nothing; cut into blocks the map shows
    // the fragmentation itself.
    const layout = layOut(fragmentedFile(20000, 100000), "bytes");
    expect(layout.rects.length).toBeGreaterThan(100);
    expect(layout.rects.every((r) => r.w >= MIN_RECT_WIDTH * 0.999)).toBe(true);
    // And they are all sample data, so the striation is drawn in mdat's color, not an anonymous grey.
    expect(layout.rects.every((r) => r.family === "mdat")).toBe(true);
  });

  it("stays a couple of lanes tall for a file the tree would draw as 60,000 rows", () => {
    const boxes = fragmentedFile(20000, 100000);
    const layout = layOut(boxes, "bytes");
    expect(boxes.reduce((n, b) => n + countAtoms(b), 0)).toBe(60000);
    expect(layout.laneCount).toBeLessThanOrEqual(2);
    // Bounded by how many blocks fit at the minimum width, not by how many atoms the file has.
    expect(layout.rects.length).toBeLessThanOrEqual(Math.ceil(1 / MIN_RECT_WIDTH));
    // Collapsed, not dropped: every atom is still behind some block.
    expect(layout.rects.reduce((n, r) => n + r.count, 0)).toBe(60000);
  });

  it("pulls the collapsed fragments apart once the view zooms to their range", () => {
    const placements = placeAtoms(fragmentedFile(20000, 100000), "bytes");
    const whole = layoutAtoms(placements, { start: 0, end: 2000000000 });
    const zoomed = layoutAtoms(placements, { start: 0, end: 1000000 });
    expect(whole.rects.some((r) => r.box?.type === "mdat")).toBe(false);
    expect(zoomed.rects.filter((r) => r.box?.type === "mdat")).toHaveLength(10);
  });

  it("drops boxes that fall outside the zoomed range entirely", () => {
    const { rects } = layoutAtoms(placeAtoms(progressiveFile(), "bytes"), { start: 32, end: 2032 });
    expect(rects.some((r) => r.box?.type === "mdat")).toBe(false);
    expect(rects.find((r) => r.box?.type === "moov")).toMatchObject({ x: 0, w: 1 });
  });

  it("clips a box that only partly overlaps the zoomed range", () => {
    const { rects } = layoutAtoms(placeAtoms(progressiveFile(), "bytes"), { start: 52032, end: 100000 });
    const mdat = rects.find((r) => r.box?.type === "mdat");
    expect(mdat).toMatchObject({ x: 0, w: 1 });
    // The zoom target stays the whole box, not the sliver of it that happens to be on screen.
    expect(mdat).toMatchObject({ from: 2032, to: 100000 });
  });
});

describe("layoutAtoms, structure axis", () => {
  it("draws every box in the file, including the ones the byte axis has no room for", () => {
    // The byte axis stops at trak here; the structure axis reaches tkhd as well.
    expect(drawnTypes(progressiveFile(), "bytes")).toEqual(["ftyp", "moov", "trak", "mdat"]);
    expect(drawnTypes(progressiveFile(), "structure")).toEqual(["ftyp", "moov", "mvhd", "trak", "tkhd", "mdat"]);
    expect(layOut(progressiveFile(), "structure").rects.every((r) => r.kind === "box")).toBe(true);
  });

  it("leaves nothing collapsed for a deep, lopsided tree the byte axis would hide", () => {
    const deep = [
      box("ftyp", 0, 32),
      box("moov", 32, 3000, [
        box("mvhd", 40, 108),
        box("trak", 148, 2000, [box("tkhd", 156, 92), box("mdia", 248, 1800, [box("hdlr", 256, 45)])]),
        box("udta", 2148, 800, [box("meta", 2156, 700)]),
      ]),
      box("mdat", 3032, 500000000),
    ];
    expect(drawnTypes(deep, "structure")).toEqual([
      "ftyp",
      "moov",
      "mvhd",
      "trak",
      "tkhd",
      "mdia",
      "hdlr",
      "udta",
      "meta",
      "mdat",
    ]);
    expect(layOut(deep, "structure").laneCount).toBe(4);
  });

  it("gives a box width from its subtree size rather than its bytes", () => {
    const { rects } = layOut(progressiveFile(), "structure");
    // mdat is 98% of the file but one atom of six, so it gets a sixth of the width.
    expect(rects.find((r) => r.box?.type === "mdat")?.w).toBeCloseTo(1 / 6);
    expect(rects.find((r) => r.box?.type === "ftyp")?.w).toBeCloseTo(1 / 6);
    expect(rects.find((r) => r.box?.type === "moov")?.w).toBeCloseTo(4 / 6);
  });

  it("still reports real byte offsets, which is what the readout shows", () => {
    const mdat = layOut(progressiveFile(), "structure").rects.find((r) => r.box?.type === "mdat");
    expect(mdat).toMatchObject({ byteStart: 2032, byteEnd: 100000 });
  });

  it("collapses a fragmented file here too, since 60,000 slots do not fit either", () => {
    const boxes = fragmentedFile(20000, 100000);
    const layout = layOut(boxes, "structure");
    expect(layout.rects.length).toBeLessThanOrEqual(Math.ceil(1 / MIN_RECT_WIDTH));
    expect(layout.rects.reduce((n, r) => n + r.count, 0)).toBe(60000);
  });
});

describe("layoutAtoms, degenerate input", () => {
  it("draws nothing for an empty tree or a collapsed range", () => {
    expect(layOut([], "bytes")).toEqual({ rects: [], laneCount: 0, truncated: false });
    expect(layOut([], "structure")).toEqual({ rects: [], laneCount: 0, truncated: false });
    expect(layoutAtoms(placeAtoms(progressiveFile(), "bytes"), { start: 10, end: 10 })).toEqual({
      rects: [],
      laneCount: 0,
      truncated: false,
    });
  });

  it("survives zero-sized boxes on the byte axis", () => {
    const boxes = [box("free", 0, 0), box("mdat", 0, 1000)];
    expect(drawnTypes(boxes, "bytes")).toEqual(["mdat"]);
    expect(drawnTypes(boxes, "structure")).toEqual(["free", "mdat"]);
  });
});
