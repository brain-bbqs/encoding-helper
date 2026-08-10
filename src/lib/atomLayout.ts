// Geometry for the Atom Map's horizontal ("byte map") orientation.
//
// The indented tree grows one row per atom, so a long recording — especially a fragmented one,
// where a moof+mdat pair repeats per fragment — runs to thousands of rows. This lays the same tree
// out along the file's byte axis instead: one lane per nesting depth, each atom drawn across the
// bytes it occupies. Height is then bounded by how deeply the file nests (a handful of lanes) no
// matter how long the video is, and width is always the width of the panel.
//
// Children sit inside their parent's byte range and siblings never overlap, so an atom is never
// wider than its parent. That makes visibility monotonic: if an atom is drawn, every one of its
// ancestors was too, and zooming into an ancestor is always the way to reach something too small
// to see on its own.

import type { BoxNode } from "./types";

/** A half-open byte range: the whole file, or the slice the map is currently zoomed to. */
export interface ByteRange {
  start: number;
  end: number;
}

/** One drawn rectangle: either a single atom, or a run of neighbours collapsed into one block. */
export interface AtomRect {
  kind: "box" | "group";
  /** Nesting depth, which is also the lane the rect is drawn in. */
  depth: number;
  /** Zoom target: an atom's full byte range, or the bytes a group's atoms span between them. */
  start: number;
  end: number;
  /** Left edge and width as fractions (0..1) of the visible range, clipped to it. */
  x: number;
  w: number;
  /** The atom itself on a "box" rect; null on a "group". */
  box: BoxNode | null;
  /** Type of the top-level atom this one descends from ("moov", "mdat", …); null on a "group". */
  family: string | null;
  /** Atoms represented: 1 for a box (its children are drawn separately), the whole collapsed count
   *  — subtrees included — for a group. */
  count: number;
}

export interface AtomLayout {
  rects: AtomRect[];
  /** Number of lanes to draw, i.e. deepest depth reached + 1. */
  laneCount: number;
  /** True when MAX_RECTS was reached and the rest of the tree was left undrawn. */
  truncated: boolean;
}

/** Narrower than this fraction of the visible range, an atom is collapsed into a group block. */
export const MIN_RECT_WIDTH = 0.002;

/**
 * Up to this many top-level atoms are all drawn, however narrow they are. A progressive file has
 * only a handful, and `ftyp` and `moov` are slivers beside `mdat` — collapsing them would hide the
 * layout the map exists to show (moov before mdat is what "faststart" means). A fragmented file has
 * thousands of them, well past this, so its runs collapse like any other lane's.
 */
const MAX_UNCOLLAPSED_TOP_LEVEL = 24;

/**
 * An atom narrower than this is not opened up: a 2 MB file's whole `moov` subtree is under 1% of
 * the file, and descending into it draws six lanes of near-identical slivers that say nothing. Its
 * contents become one summary block on the next lane instead, and zooming in is what opens them.
 */
const MIN_EXPAND_WIDTH = 0.02;

/** Backstop for pathological files; a real one settles far below this once groups collapse runs. */
const MAX_RECTS = 4000;

/** Atoms in a subtree, counting the box itself. */
export function countAtoms(box: BoxNode): number {
  return box.children.reduce((n, c) => n + countAtoms(c), 1);
}

/** The byte range the whole tree spans, which for a well-formed file is the whole file. */
export function treeRange(boxes: BoxNode[]): ByteRange {
  if (boxes.length === 0) return { start: 0, end: 0 };
  let start = Infinity;
  let end = -Infinity;
  for (const box of boxes) {
    start = Math.min(start, box.start);
    end = Math.max(end, box.start + box.size);
  }
  return { start, end };
}

interface Clipped {
  box: BoxNode;
  from: number;
  to: number;
}

/** The parts of `siblings` that fall inside `view`, in byte order. */
function clipToView(siblings: BoxNode[], view: ByteRange): Clipped[] {
  return siblings
    .map((box) => ({
      box,
      from: Math.max(box.start, view.start),
      to: Math.min(box.start + box.size, view.end),
    }))
    .filter((c) => c.to > c.from)
    .sort((a, b) => a.from - b.from);
}

/**
 * Places every atom visible in `view` on the byte axis. Anything too narrow to draw or to open up
 * becomes a group block saying how many atoms it stands for, and zooming to that block's range is
 * what pulls them apart — so nothing is ever silently dropped.
 */
export function layoutAtoms(boxes: BoxNode[], view: ByteRange, minWidth: number = MIN_RECT_WIDTH): AtomLayout {
  const span = view.end - view.start;
  const rects: AtomRect[] = [];
  if (span <= 0) return { rects, laneCount: 0, truncated: false };
  let laneCount = 0;
  let truncated = false;

  const pushGroup = (depth: number, from: number, to: number, count: number): void => {
    laneCount = Math.max(laneCount, depth + 1);
    rects.push({
      kind: "group",
      depth,
      start: from,
      end: to,
      x: (from - view.start) / span,
      w: (to - from) / span,
      box: null,
      family: null,
      count,
    });
  };

  const walk = (siblings: BoxNode[], depth: number, inherited: string | null): void => {
    const visible = clipToView(siblings, view);
    const floor = depth === 0 && visible.length <= MAX_UNCOLLAPSED_TOP_LEVEL ? 0 : minWidth;
    let i = 0;
    while (i < visible.length) {
      if (rects.length >= MAX_RECTS) {
        truncated = true;
        return;
      }
      const current = visible[i];
      const width = (current.to - current.from) / span;
      if (width < floor) {
        // A run of neighbours that are each too narrow to draw shares one block.
        let end = i;
        let count = 0;
        while (end < visible.length && (visible[end].to - visible[end].from) / span < floor) {
          count += countAtoms(visible[end].box);
          end++;
        }
        pushGroup(depth, visible[i].from, visible[end - 1].to, count);
        i = end;
        continue;
      }
      laneCount = Math.max(laneCount, depth + 1);
      // Top-level atoms name their own family; everything below inherits the one it descends from.
      const family = inherited ?? current.box.type;
      rects.push({
        kind: "box",
        depth,
        start: current.box.start,
        end: current.box.start + current.box.size,
        x: (current.from - view.start) / span,
        w: width,
        box: current.box,
        family,
        count: 1,
      });
      if (current.box.children.length > 0) {
        if (width >= MIN_EXPAND_WIDTH) walk(current.box.children, depth + 1, family);
        else pushGroup(depth + 1, current.from, current.to, countAtoms(current.box) - 1);
      }
      i++;
    }
  };

  walk(boxes, 0, null);
  return { rects, laneCount, truncated };
}
