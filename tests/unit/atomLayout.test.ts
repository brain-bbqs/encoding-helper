import { describe, expect, it } from "vitest";
import { countAtoms, layoutAtoms, MIN_RECT_WIDTH, placeAtoms, placementRange } from "../../src/lib/atomLayout";
import type { BoxNode } from "../../src/lib/types";

function box(type: string, start: number, size: number, children: BoxNode[] = []): BoxNode {
  return { type, start, size, children };
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

/** Lays a whole file out, the way the tab does before any zooming. */
function layOut(boxes: BoxNode[]) {
  const placements = placeAtoms(boxes);
  return layoutAtoms(placements, placementRange(placements));
}

function drawnTypes(boxes: BoxNode[]): (string | undefined)[] {
  return layOut(boxes)
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
  it("splits the axis between siblings by how many boxes each subtree holds", () => {
    // Six atoms: ftyp and mdat take one slot each, and moov's subtree takes the other four.
    const placements = placeAtoms(progressiveFile());
    const [ftyp, moov, mdat] = placements;
    expect(placementRange(placements)).toEqual({ start: 0, end: 6 });
    expect(ftyp).toMatchObject({ from: 0, to: 1 });
    expect(moov).toMatchObject({ from: 1, to: 5 });
    expect(mdat).toMatchObject({ from: 5, to: 6 });
    // mvhd is one atom of the three under moov; trak's subtree is the other two.
    expect(moov.children[0]).toMatchObject({ from: 1, to: 1 + 4 / 3 });
    expect(moov.children[1].children[0]).toMatchObject({ to: 5 });
  });

  it("keeps children inside their parent", () => {
    const [, moov] = placeAtoms(progressiveFile());
    for (const child of moov.children) {
      expect(child.from).toBeGreaterThanOrEqual(moov.from);
      expect(child.to).toBeLessThanOrEqual(moov.to);
    }
  });

  it("is unmoved by how big the boxes are, only by how many there are", () => {
    const tiny = [box("moov", 0, 100, [box("mvhd", 8, 90)]), box("mdat", 100, 200)];
    const huge = [box("moov", 0, 100, [box("mvhd", 8, 90)]), box("mdat", 100, 4e9)];
    expect(placeAtoms(tiny).map((p) => [p.from, p.to])).toEqual(placeAtoms(huge).map((p) => [p.from, p.to]));
  });
});

describe("layoutAtoms", () => {
  it("draws every box in the file, each labelled with its own lane and slice", () => {
    const { rects, laneCount } = layOut(progressiveFile());
    expect(drawnTypes(progressiveFile())).toEqual(["ftyp", "moov", "mvhd", "trak", "tkhd", "mdat"]);
    expect(rects.every((r) => r.kind === "box")).toBe(true);
    expect(laneCount).toBe(3);
  });

  it("gives a box width from its subtree size rather than its bytes", () => {
    const { rects } = layOut(progressiveFile());
    // mdat is 98% of the file but one box of six, so it gets a sixth of the width.
    expect(rects.find((r) => r.box?.type === "mdat")?.w).toBeCloseTo(1 / 6);
    expect(rects.find((r) => r.box?.type === "ftyp")?.w).toBeCloseTo(1 / 6);
    expect(rects.find((r) => r.box?.type === "moov")?.w).toBeCloseTo(4 / 6);
  });

  it("leaves nothing collapsed for a deep, lopsided tree", () => {
    const deep = [
      box("ftyp", 0, 32),
      box("moov", 32, 3000, [
        box("mvhd", 40, 108),
        box("trak", 148, 2000, [box("tkhd", 156, 92), box("mdia", 248, 1800, [box("hdlr", 256, 45)])]),
        box("udta", 2148, 800, [box("meta", 2156, 700)]),
      ]),
      box("mdat", 3032, 500000000),
    ];
    expect(drawnTypes(deep)).toEqual(["ftyp", "moov", "mvhd", "trak", "tkhd", "mdia", "hdlr", "udta", "meta", "mdat"]);
    expect(layOut(deep).laneCount).toBe(4);
  });

  it("puts children in the lane below their parent", () => {
    const { rects } = layOut(progressiveFile());
    expect(rects.find((r) => r.box?.type === "moov")?.depth).toBe(0);
    expect(rects.find((r) => r.box?.type === "trak")?.depth).toBe(1);
    expect(rects.find((r) => r.box?.type === "tkhd")?.depth).toBe(2);
  });

  it("labels every descendant with the top-level box it belongs to", () => {
    const { rects } = layOut(progressiveFile());
    expect(rects.find((r) => r.box?.type === "tkhd")?.family).toBe("moov");
    expect(rects.find((r) => r.box?.type === "mdat")?.family).toBe("mdat");
  });

  it("reports real byte offsets, which is what the readout shows", () => {
    const mdat = layOut(progressiveFile()).rects.find((r) => r.box?.type === "mdat");
    expect(mdat).toMatchObject({ byteStart: 2032, byteEnd: 100000 });
  });

  it("keeps every top-level box, however many boxes its siblings' subtrees hold", () => {
    // ftyp and mdat are one box each against a moov subtree of 200; the file's outermost shape is
    // never summarised away.
    const crowded: BoxNode[] = [
      box("ftyp", 0, 32),
      box(
        "moov",
        32,
        2000,
        Array.from({ length: 199 }, (_, i) => box("trak", 40 + i, 1)),
      ),
      box("mdat", 2032, 97968),
    ];
    const top = layOut(crowded).rects.filter((r) => r.depth === 0);
    expect(top.map((r) => r.box?.type)).toEqual(["ftyp", "moov", "mdat"]);
  });
});

describe("layoutAtoms, files with more boxes than fit", () => {
  it("collapses what will not fit into counted blocks rather than dropping it", () => {
    const boxes = fragmentedFile(20000, 100000);
    const layout = layOut(boxes);
    expect(boxes.reduce((n, b) => n + countAtoms(b), 0)).toBe(60000);
    // Bounded by how many blocks fit at the minimum width, not by how many boxes the file has.
    expect(layout.laneCount).toBeLessThanOrEqual(2);
    expect(layout.rects.length).toBeLessThanOrEqual(Math.ceil(1 / MIN_RECT_WIDTH));
    expect(layout.rects.reduce((n, r) => n + r.count, 0)).toBe(60000);
  });

  it("cuts a collapsed run once it is wide enough to draw, so the map striates", () => {
    // Every box of a heavily fragmented file is too narrow to draw. Merged into a single run they
    // would be one block spanning the whole map, which says nothing; cut into blocks the map shows
    // the fragmentation itself.
    const layout = layOut(fragmentedFile(20000, 100000));
    expect(layout.rects.length).toBeGreaterThan(100);
    expect(layout.rects.every((r) => r.w >= MIN_RECT_WIDTH * 0.999)).toBe(true);
    // Each block is drawn in the color of whatever fills most of it rather than an anonymous grey.
    // Width here is box count, and each fragment is two moof boxes to one mdat, so moof it is.
    expect(layout.rects.every((r) => r.family === "moof")).toBe(true);
  });

  it("pulls the collapsed boxes apart once the view zooms in on them", () => {
    const placements = placeAtoms(fragmentedFile(20000, 100000));
    let layout = layoutAtoms(placements, placementRange(placements));
    expect(layout.rects.every((r) => r.kind === "group")).toBe(true);

    // Zooming into the leftmost block repeatedly always reaches real boxes, and quickly: each step
    // divides the boxes in view by the number of blocks the last one was cut into.
    let steps = 0;
    while (!layout.rects.some((r) => r.kind === "box") && steps < 5) {
      layout = layoutAtoms(placements, { start: layout.rects[0].from, end: layout.rects[0].to });
      steps++;
    }
    expect(steps).toBe(1);
    expect(layout.rects.filter((r) => r.kind === "box").map((r) => r.box?.type)).toContain("moof");
  });

  it("keeps a group's byte range and count, so a collapsed block still says what it holds", () => {
    const group = layOut(fragmentedFile(2000, 100000)).rects[0];
    expect(group.kind).toBe("group");
    expect(group.count).toBeGreaterThan(1);
    expect(group.byteStart).toBe(0);
    expect(group.byteEnd).toBeGreaterThan(group.byteStart);
  });
});

describe("layoutAtoms, degenerate input", () => {
  it("draws nothing for an empty tree or a collapsed range", () => {
    expect(layOut([])).toEqual({ rects: [], laneCount: 0, truncated: false });
    expect(layoutAtoms(placeAtoms(progressiveFile()), { start: 3, end: 3 })).toEqual({
      rects: [],
      laneCount: 0,
      truncated: false,
    });
  });

  it("draws zero-byte boxes, which have a slot like any other", () => {
    expect(drawnTypes([box("free", 0, 0), box("mdat", 0, 1000)])).toEqual(["free", "mdat"]);
  });
});
