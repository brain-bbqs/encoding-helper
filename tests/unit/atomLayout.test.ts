import { describe, expect, it } from "vitest";
import { countAtoms, layoutAtoms, treeRange } from "../../src/lib/atomLayout";
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

describe("countAtoms", () => {
  it("counts the box itself plus every descendant", () => {
    expect(countAtoms(progressiveFile()[1])).toBe(4);
    expect(countAtoms(box("mdat", 0, 10))).toBe(1);
  });
});

describe("treeRange", () => {
  it("spans from the first byte of the first box to the last byte of the last", () => {
    expect(treeRange(progressiveFile())).toEqual({ start: 0, end: 100000 });
  });

  it("is empty for a file with no parsed boxes", () => {
    expect(treeRange([])).toEqual({ start: 0, end: 0 });
  });
});

describe("layoutAtoms", () => {
  it("places each box across the bytes it occupies, as a fraction of the visible range", () => {
    const { rects, laneCount } = layoutAtoms(progressiveFile(), { start: 0, end: 100000 });
    const mdat = rects.find((r) => r.box?.type === "mdat");
    expect(mdat?.x).toBeCloseTo(0.02032);
    expect(mdat?.w).toBeCloseTo(0.97968);
    expect(rects.filter((r) => r.kind === "box").map((r) => r.box?.type)).toEqual([
      "ftyp",
      "moov",
      "trak",
      "mdat",
    ]);
    expect(laneCount).toBe(3);
  });

  it("keeps every top-level box of a progressive file, however thin ftyp and moov come out", () => {
    // 32 B of ftyp in a 4 GB file rounds to nothing, but where moov sits relative to mdat is the
    // whole point of the map, so neither is allowed to collapse away.
    const boxes = [box("ftyp", 0, 32), box("moov", 32, 2000), box("mdat", 2032, 4e9)];
    const { rects } = layoutAtoms(boxes, treeRange(boxes));
    expect(rects.map((r) => r.box?.type)).toEqual(["ftyp", "moov", "mdat"]);
  });

  it("puts children in the lane below their parent", () => {
    const { rects } = layoutAtoms(progressiveFile(), { start: 0, end: 100000 });
    expect(rects.find((r) => r.box?.type === "moov")?.depth).toBe(0);
    expect(rects.find((r) => r.box?.type === "trak")?.depth).toBe(1);
  });

  it("labels every descendant with the top-level box it belongs to", () => {
    const { rects } = layoutAtoms(progressiveFile(), { start: 0, end: 100000 });
    expect(rects.find((r) => r.box?.type === "trak")?.family).toBe("moov");
    expect(rects.find((r) => r.box?.type === "mdat")?.family).toBe("mdat");
  });

  it("collapses a run of too-narrow neighbours into one group covering the bytes they span", () => {
    // mvhd (108 B of 100 kB) is too narrow to draw, and stands alone before trak, which is not.
    const groups = layoutAtoms(progressiveFile(), { start: 0, end: 100000 }).rects.filter(
      (r) => r.kind === "group" && r.depth === 1,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ start: 40, end: 148, count: 1, box: null, family: null });
  });

  it("sums a box too narrow to open up into one block on the lane below it", () => {
    // moov is well under 1% of a 4 GB file, so descending into it would draw lane after lane of
    // identical slivers; the whole subtree becomes a single block that zooming opens instead.
    const boxes = [box("moov", 0, 2000, [box("trak", 8, 1900, [box("tkhd", 16, 92)])]), box("mdat", 2000, 4e9)];
    const { rects, laneCount } = layoutAtoms(boxes, treeRange(boxes));
    expect(laneCount).toBe(2);
    expect(rects.filter((r) => r.kind === "box").map((r) => r.box?.type)).toEqual(["moov", "mdat"]);
    expect(rects.find((r) => r.kind === "group")).toMatchObject({ depth: 1, start: 0, end: 2000, count: 2 });
  });

  it("counts whole subtrees in a group, so the block says how many boxes it stands for", () => {
    const boxes = fragmentedFile(2000, 100000);
    const group = layoutAtoms(boxes, treeRange(boxes)).rects.find((r) => r.kind === "group");
    // Each fragment is a moof (with its own mfhd) plus an mdat: three atoms behind one block.
    expect(group?.count).toBe(6000);
  });

  it("stays a couple of lanes tall for a file the tree would draw as 60,000 rows", () => {
    const boxes = fragmentedFile(20000, 100000);
    const layout = layoutAtoms(boxes, treeRange(boxes));
    expect(boxes.reduce((n, b) => n + countAtoms(b), 0)).toBe(60000);
    expect(layout.laneCount).toBeLessThanOrEqual(2);
    expect(layout.rects.length).toBeLessThan(50);
    // Collapsed, not dropped: every atom is still behind some block.
    expect(layout.rects.reduce((n, r) => n + r.count, 0)).toBe(60000);
  });

  it("pulls the collapsed fragments apart once the view zooms to their range", () => {
    const boxes = fragmentedFile(20000, 100000);
    const whole = layoutAtoms(boxes, { start: 0, end: 2000000000 });
    const zoomed = layoutAtoms(boxes, { start: 0, end: 1000000 });
    expect(whole.rects.some((r) => r.box?.type === "mdat")).toBe(false);
    expect(zoomed.rects.filter((r) => r.box?.type === "mdat")).toHaveLength(10);
  });

  it("drops boxes that fall outside the zoomed range entirely", () => {
    const { rects } = layoutAtoms(progressiveFile(), { start: 32, end: 2032 });
    expect(rects.some((r) => r.box?.type === "mdat")).toBe(false);
    expect(rects.find((r) => r.box?.type === "moov")).toMatchObject({ x: 0, w: 1 });
  });

  it("clips a box that only partly overlaps the zoomed range", () => {
    const { rects } = layoutAtoms(progressiveFile(), { start: 52032, end: 100000 });
    const mdat = rects.find((r) => r.box?.type === "mdat");
    expect(mdat).toMatchObject({ x: 0, w: 1 });
    // The zoom target stays the whole box, not the sliver of it that happens to be on screen.
    expect(mdat).toMatchObject({ start: 2032, end: 100000 });
  });

  it("draws nothing for an empty tree or a collapsed range", () => {
    expect(layoutAtoms([], { start: 0, end: 100 })).toEqual({ rects: [], laneCount: 0, truncated: false });
    expect(layoutAtoms(progressiveFile(), { start: 10, end: 10 })).toEqual({
      rects: [],
      laneCount: 0,
      truncated: false,
    });
  });
});
