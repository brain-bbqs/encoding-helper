// Tab: Atom Map — MP4 box/atom tree with byte offsets and sizes.

import { h, teachBox } from "../lib/dom";
import { fmtBytes } from "../lib/format";
import { state } from "../lib/state";
import type { BoxNode } from "../lib/types";

function renderNode(tree: HTMLElement, box: BoxNode, depth: number): void {
  const row = h("div", "atom-row");
  row.style.paddingLeft = depth * 18 + "px";
  row.append(h("span", "type", box.type));
  row.append(h("span", "off", "offset " + box.start.toLocaleString()));
  row.append(h("span", "sz", fmtBytes(box.size) + " (" + box.size.toLocaleString() + " B)"));
  if (box.type === "moov") row.append(h("span", "tag", "index"));
  if (box.type === "mdat") row.append(h("span", "tag", "sample data"));
  if (box.type === "ftyp") row.append(h("span", "tag", "brand"));
  tree.append(row);
  box.children.forEach((c) => renderNode(tree, c, depth + 1));
}

export function renderAtomMap(panel: HTMLElement): void {
  panel.innerHTML = "";

  const sec = h("div", "section");
  sec.append(h("h2", null, "MP4 Box / Atom Structure"));
  sec.append(
    teachBox(
      `An MP4 file is a tree of <b>boxes</b> (also called &ldquo;atoms&rdquo;): <code>ftyp</code> declares the ` +
        `brand/compatibility, <code>moov</code> holds all metadata &amp; the sample index (offsets, sizes, ` +
        `timestamps, keyframe flags), and <code>mdat</code> holds the raw encoded frame bytes it points to. ` +
        `Fragmented MP4s repeat <code>moof</code>+<code>mdat</code> pairs instead of one big <code>mdat</code>.`,
    ),
  );

  const tree = h("div", "atom-tree");
  state.boxes.forEach((b) => renderNode(tree, b, 0));
  const treeScroll = h("div", "scroll-x");
  treeScroll.append(tree);
  sec.append(treeScroll);
  panel.append(sec);
}
