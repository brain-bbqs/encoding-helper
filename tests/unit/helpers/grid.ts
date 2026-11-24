// Reading a figure off one of the label-and-value grids the tabs render. Imports nothing, so no test
// file's vi.mock reaches it.

/** The grid item labelled `label` under `root`, or a thrown "no grid item labelled ...". */
export function gridItem(root: ParentNode, label: string): HTMLElement {
  const item = Array.from(root.querySelectorAll<HTMLElement>(".item")).find(
    (el) => el.querySelector("label")?.textContent === label,
  );
  if (!item) throw new Error(`no grid item labelled "${label}"`);
  return item;
}

/** The value the grid item labelled `label` shows, or null when it has no value cell. */
export function gridValue(root: ParentNode, label: string): string | null {
  return gridItem(root, label).querySelector(".val")?.textContent ?? null;
}
