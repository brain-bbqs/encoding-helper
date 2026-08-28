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
    browseDemosBtn: required<HTMLButtonElement>("browseDemosBtn"),
    showUrlBtn: required<HTMLButtonElement>("showUrlBtn"),
    urlRow: required<HTMLDivElement>("urlRow"),
    urlInput: required<HTMLInputElement>("urlInput"),
    loadUrlBtn: required<HTMLButtonElement>("loadUrlBtn"),
    miniName: required<HTMLSpanElement>("miniName"),
    miniSize: required<HTMLSpanElement>("miniSize"),
    resetBtn: required<HTMLButtonElement>("resetBtn"),
    fileInput: required<HTMLInputElement>("fileInput"),
    demosPage: required<HTMLDivElement>("demosPage"),
    app: required<HTMLDivElement>("app"),
    themeToggle: required<HTMLButtonElement>("themeToggle"),
    versionIndicator: required<HTMLAnchorElement>("version-indicator"),
    clearCacheBtn: required<HTMLButtonElement>("clear-matrix-cache-btn"),
    panels: {
      inspect: required<HTMLDivElement>("panel-inspect"),
      encode: required<HTMLDivElement>("panel-encode"),
      compare: required<HTMLDivElement>("panel-compare"),
      analysis: required<HTMLDivElement>("panel-analysis"),
    },
  };
}

export type AppElements = ReturnType<typeof getElements>;
