// Box-tree fixtures for the atom map: one box written in a line, and the plain file most cases draw.

import type { BoxNode } from "../../src/lib/types";

export function box(type: string, start: number, size: number, children: BoxNode[] = []): BoxNode {
  return { type, start, size, children };
}

/** A plain, unfragmented file: ftyp, then a moov holding a header and one trak, then the payload. */
export function progressiveFile(): BoxNode[] {
  return [
    box("ftyp", 0, 32),
    box("moov", 32, 2000, [box("mvhd", 40, 108), box("trak", 148, 1800, [box("tkhd", 156, 92)])]),
    box("mdat", 2032, 97968),
  ];
}
