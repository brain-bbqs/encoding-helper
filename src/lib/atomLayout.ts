// Geometry for the Atom Map's horizontal orientations.
//
// The indented tree grows one row per atom, so a long recording — especially a fragmented one,
// where a moof+mdat pair repeats per fragment — runs to thousands of rows. Both horizontal views
// lay the same tree out along an axis instead: one lane per nesting depth, each atom drawn across
// its slice of that axis. Height is then bounded by how deeply the file nests (a handful of lanes)
// no matter how long the video is, and width is always the width of the panel.
//
// What the axis measures is the whole difference between the two:
//
//   "bytes"     — the file itself. An atom is as wide as the bytes it occupies, so a well-encoded
//                 file is nearly all mdat and moov-before-mdat (faststart) is visible at a glance.
//                 The cost is that a moov under 1% of the file has no room to show its 24 children.
//   "structure" — one slot per atom. Siblings split their parent's slice in proportion to how many
//                 atoms each subtree holds, so every atom in the file gets drawn and labelled, at
//                 the price of saying nothing about size. This is the indented tree, turned on its
//                 side.
//
// Either way, atoms are contained by their parent and siblings never overlap, so an atom is never
// wider than its parent. That makes visibility monotonic: if an atom is drawn, every one of its
// ancestors was too, and zooming into an ancestor is always the way to reach something too small
// to see on its own.

import type { BoxNode } from "./types";

export type AtomScale = "bytes" | "structure";

/** A half-open range on whichever axis the layout is using — file bytes, or atom slots. */
export interface AxisRange {
  start: number;
  end: number;
}

/** An atom with the slice of the axis it was given, and its children placed inside that slice. */
export interface Placement {
  box: BoxNode;
  from: number;
  to: number;
  children: Placement[];
}

/** One drawn rectangle: either a single atom, or a run of neighbours collapsed into one block. */
export interface AtomRect {
  kind: "box" | "group";
  /** Nesting depth, which is also the lane the rect is drawn in. */
  depth: number;
  /** Zoom target, on the layout's own axis. */
  from: number;
  to: number;
  /** The bytes this rect covers, which is what the readout reports whatever the axis is. */
  byteStart: number;
  byteEnd: number;
  /** Left edge and width as fractions (0..1) of the visible range, clipped to it. */
  x: number;
  w: number;
  /** The atom itself on a "box" rect; null on a "group". */
  box: BoxNode | null;
  /** Type of the top-level atom this one descends from ("moov", "mdat", …). On a "group" holding a
   *  mix, it is whichever family covers most of the block — so a fragmented file's collapsed runs
   *  still read as the sample data they mostly are. Null only when there is nothing to name. */
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

/**
 * Narrower than this fraction of the visible range, an atom is collapsed into a group block. Set so
 * that a block at the threshold is still a few real pixels wide at any sensible panel width, since
 * anything thinner would be widened by the stylesheet's minimum and start overlapping its neighbour.
 */
export const MIN_RECT_WIDTH = 0.005;

/**
 * Up to this many top-level atoms are all drawn, however narrow they are. A progressive file has
 * only a handful, and `ftyp` and `moov` are slivers beside `mdat` — collapsing them would hide the
 * layout the map exists to show (moov before mdat is what "faststart" means). A fragmented file has
 * thousands of them, well past this, so its runs collapse like any other lane's.
 */
const MAX_UNCOLLAPSED_TOP_LEVEL = 24;

/**
 * An atom narrower than this is not opened up: on the byte axis a 2 MB file's whole `moov` subtree
 * is under 1% of the file, and descending into it draws lane after lane of near-identical slivers
 * that say nothing. Its contents become one summary block on the next lane instead, and zooming in
 * — or the structure axis, which gives every atom room by construction — is what opens them.
 */
const MIN_EXPAND_WIDTH = 0.02;

/** Backstop for pathological files; a real one settles far below this once groups collapse runs. */
const MAX_RECTS = 4000;

/** Atoms in a subtree, counting the box itself. */
export function countAtoms(box: BoxNode): number {
  return box.children.reduce((n, c) => n + countAtoms(c), 1);
}

function placeByBytes(boxes: BoxNode[]): Placement[] {
  return boxes.map((box) => ({
    box,
    from: box.start,
    to: box.start + box.size,
    children: placeByBytes(box.children),
  }));
}

// Siblings divide their parent's slice in proportion to how many atoms each of them brings, so a
// subtree with more in it gets more room to show it and no atom is ever squeezed below its share.
function placeByStructure(boxes: BoxNode[], from: number, to: number): Placement[] {
  const weights = boxes.map(countAtoms);
  const total = weights.reduce((a, b) => a + b, 0);
  if (total === 0) return [];
  const span = to - from;
  let cursor = from;
  return boxes.map((box, i) => {
    const next = cursor + (span * weights[i]) / total;
    const placement: Placement = { box, from: cursor, to: next, children: [] };
    placement.children = placeByStructure(box.children, cursor, next);
    cursor = next;
    return placement;
  });
}

/** Assigns every atom its slice of the chosen axis. */
export function placeAtoms(boxes: BoxNode[], scale: AtomScale): Placement[] {
  if (scale === "bytes") return placeByBytes(boxes);
  return placeByStructure(
    boxes,
    0,
    boxes.reduce((n, b) => n + countAtoms(b), 0),
  );
}

/** The range the placed tree spans, which on the byte axis is the whole file. */
export function placementRange(placements: Placement[]): AxisRange {
  if (placements.length === 0) return { start: 0, end: 0 };
  let start = Infinity;
  let end = -Infinity;
  for (const placement of placements) {
    start = Math.min(start, placement.from);
    end = Math.max(end, placement.to);
  }
  return { start, end };
}

interface Clipped {
  placement: Placement;
  from: number;
  to: number;
}

/** Whichever top-level family covers most of a collapsed run, by width on the axis in play. */
function dominantFamily(run: Clipped[]): string | null {
  const widths = new Map<string, number>();
  for (const c of run) {
    const type = c.placement.box.type;
    widths.set(type, (widths.get(type) ?? 0) + (c.to - c.from));
  }
  let winner: string | null = null;
  let best = -1;
  // Insertion order is axis order, and the comparison is strict, so ties go to the leftmost.
  for (const [type, width] of widths) {
    if (width > best) {
      best = width;
      winner = type;
    }
  }
  return winner;
}

/** The parts of `siblings` that fall inside `view`, in axis order. */
function clipToView(siblings: Placement[], view: AxisRange): Clipped[] {
  return siblings
    .map((placement) => ({
      placement,
      from: Math.max(placement.from, view.start),
      to: Math.min(placement.to, view.end),
    }))
    .filter((c) => c.to > c.from)
    .sort((a, b) => a.from - b.from);
}

/**
 * Places every atom visible in `view` on the axis it was given. Anything too narrow to draw or to
 * open up becomes a group block saying how many atoms it stands for, and zooming to that block's
 * range is what pulls them apart — so nothing is ever silently dropped.
 */
export function layoutAtoms(placements: Placement[], view: AxisRange, minWidth: number = MIN_RECT_WIDTH): AtomLayout {
  const span = view.end - view.start;
  const rects: AtomRect[] = [];
  if (span <= 0) return { rects, laneCount: 0, truncated: false };
  let laneCount = 0;
  let truncated = false;

  const pushGroup = (depth: number, run: Clipped[], inherited: string | null): void => {
    if (run.length === 0) return;
    laneCount = Math.max(laneCount, depth + 1);
    const from = run[0].from;
    const to = run[run.length - 1].to;
    // Folded rather than spread: a fragmented file's run can hold tens of thousands of atoms, well
    // past the argument limit Math.min(...xs) would hit.
    let byteStart = Infinity;
    let byteEnd = -Infinity;
    for (const c of run) {
      byteStart = Math.min(byteStart, c.placement.box.start);
      byteEnd = Math.max(byteEnd, c.placement.box.start + c.placement.box.size);
    }
    rects.push({
      kind: "group",
      depth,
      from,
      to,
      byteStart,
      byteEnd,
      x: (from - view.start) / span,
      w: (to - from) / span,
      box: null,
      // Below the top level every member descends from the same top-level box already.
      family: inherited ?? dominantFamily(run),
      count: run.reduce((n, c) => n + countAtoms(c.placement.box), 0),
    });
  };

  const walk = (siblings: Placement[], depth: number, inherited: string | null): void => {
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
        // A run of neighbours that are each too narrow to draw shares one block, and the run is cut
        // as soon as it is itself wide enough to draw. Without that cut, a file whose every atom is
        // too narrow — a long fragmented recording, where all of them are — would merge into one
        // block spanning the whole map, saying only how many boxes are somewhere inside it. Cut
        // this way it striates instead: a run of blocks whose density is the fragmentation.
        let end = i;
        while (end < visible.length && (visible[end].to - visible[end].from) / span < floor) {
          end++;
          if ((visible[end - 1].to - visible[i].from) / span >= floor) break;
        }
        pushGroup(depth, visible.slice(i, end), inherited);
        i = end;
        continue;
      }
      laneCount = Math.max(laneCount, depth + 1);
      const box = current.placement.box;
      // Top-level atoms name their own family; everything below inherits the one it descends from.
      const family = inherited ?? box.type;
      rects.push({
        kind: "box",
        depth,
        from: current.placement.from,
        to: current.placement.to,
        byteStart: box.start,
        byteEnd: box.start + box.size,
        x: (current.from - view.start) / span,
        w: width,
        box,
        family,
        count: 1,
      });
      if (current.placement.children.length > 0) {
        if (width >= MIN_EXPAND_WIDTH) walk(current.placement.children, depth + 1, family);
        else pushGroup(depth + 1, clipToView(current.placement.children, view), family);
      }
      i++;
    }
  };

  walk(placements, 0, null);
  return { rects, laneCount, truncated };
}
