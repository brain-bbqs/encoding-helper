// Typed lookups for the static skeleton markup in index.html.

function required<T extends Element>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Expected #${id} to exist in the document`);
  return el as unknown as T;
}

export function getElements() {
  return {
    errorMsg: required<HTMLDivElement>("errorMsg"),
    dropZone: required<HTMLDivElement>("dropZone"),
    pickFileBtn: required<HTMLButtonElement>("pickFileBtn"),
    loadSampleBtn: required<HTMLButtonElement>("loadSampleBtn"),
    showUrlBtn: required<HTMLButtonElement>("showUrlBtn"),
    urlRow: required<HTMLDivElement>("urlRow"),
    urlInput: required<HTMLInputElement>("urlInput"),
    loadUrlBtn: required<HTMLButtonElement>("loadUrlBtn"),
    miniName: required<HTMLSpanElement>("miniName"),
    miniSize: required<HTMLSpanElement>("miniSize"),
    loadAnotherBtn: required<HTMLButtonElement>("loadAnotherBtn"),
    fileInput: required<HTMLInputElement>("fileInput"),
    app: required<HTMLDivElement>("app"),
    printArea: required<HTMLDivElement>("printArea"),
    themeToggle: required<HTMLButtonElement>("themeToggle"),
    versionIndicator: required<HTMLAnchorElement>("version-indicator"),
    panels: {
      inspect: required<HTMLDivElement>("panel-inspect"),
      atoms: required<HTMLDivElement>("panel-atoms"),
      seek: required<HTMLDivElement>("panel-seek"),
      encode: required<HTMLDivElement>("panel-encode"),
      compare: required<HTMLDivElement>("panel-compare"),
      reencode: required<HTMLDivElement>("panel-reencode"),
      report: required<HTMLDivElement>("panel-report"),
    },
  };
}

export type AppElements = ReturnType<typeof getElements>;
