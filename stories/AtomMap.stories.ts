import { state } from "../src/lib/state";
import type { BoxNode } from "../src/lib/types";
import { renderAtomMap, type AtomOrientation } from "../src/ui/atomsTab";

function box(type: string, start: number, size: number, children: BoxNode[] = []): BoxNode {
  return { type, start, size, hdrSize: 8, children };
}

/** A progressive file: ftyp, a moov small enough to collapse, then the sample payload. */
const PROGRESSIVE: BoxNode[] = [
  box("ftyp", 0, 32),
  box("moov", 32, 17531, [
    box("mvhd", 40, 108),
    box("trak", 148, 17317, [box("tkhd", 156, 92), box("mdia", 284, 17181, [box("hdlr", 292, 45)])]),
    box("udta", 17465, 98),
  ]),
  box("free", 17563, 8),
  box("mdat", 17571, 2119170),
];

/** A fragmented file: the shape a long recording takes, and what the indented tree cannot show. */
const FRAGMENTED: BoxNode[] = (() => {
  const boxes: BoxNode[] = [box("ftyp", 0, 32), box("moov", 32, 1200, [box("mvhd", 40, 108)])];
  for (let i = 0; i < 400; i++) {
    const at = 1232 + i * 24000;
    boxes.push(box("moof", at, 320, [box("mfhd", at + 8, 16)]));
    boxes.push(box("mdat", at + 320, 23680));
  }
  return boxes;
})();

// The orientation is passed explicitly rather than left to the remembered preference, so a
// snapshot never depends on which view was last clicked.
function renderWith(boxes: BoxNode[], orientation: AtomOrientation): HTMLElement {
  state.boxes = boxes;
  const panel = document.createElement("div");
  renderAtomMap(panel, orientation);
  return panel;
}

export default {
  title: "Components/Atom Map",
};

export const Horizontal = {
  name: "Horizontal byte map",
  render: () => renderWith(PROGRESSIVE, "horizontal"),
};

export const Fragmented = {
  name: "Horizontal byte map, fragmented file",
  render: () => renderWith(FRAGMENTED, "horizontal"),
};

export const Vertical = {
  name: "Vertical tree",
  render: () => renderWith(PROGRESSIVE, "vertical"),
};
