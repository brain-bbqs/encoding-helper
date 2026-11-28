// Telling a drag that carries files from one carrying a link or text, and refusing the files nothing
// on the page took. Shared by the drop zone and the Full Analysis preview, whose frame is a document
// of its own that the page's guard does not reach.

/** Whether a drag holds files, as one from the desktop does, rather than a link or text. */
export function carriesFiles(e: DragEvent): boolean {
  return e.dataTransfer?.types.includes("Files") ?? false;
}

/**
 * Cancels every file drag over `target`, which the browser would otherwise open itself, in a new
 * tab or in place of the app. Files only, so text and links dropped into the page's inputs still
 * land.
 */
export function refuseStrayFileDrops(target: GlobalEventHandlers): void {
  const refuse = (e: DragEvent): void => {
    if (carriesFiles(e)) e.preventDefault();
  };
  target.addEventListener("dragover", refuse);
  target.addEventListener("drop", refuse);
}
