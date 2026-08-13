// Shareable app state in the address bar.
//
// Two things live in the query string: `tab`, so a link points at the panel the sender was looking
// at, and `src`, the remote video URL when the file was loaded from one. Local files can never be
// shared this way (the browser gives no readable path, and the recipient would not have the file),
// so loading one clears `src`.

// "analysis" is the Full Analysis document, reached from the button beside the tab row rather than
// from a tab, but it is a place the app can be in and so is linkable like the rest.
export const TAB_IDS = ["inspect", "atoms", "seek", "encode", "compare", "reencode", "analysis"] as const;

export type TabId = (typeof TAB_IDS)[number];

export const DEFAULT_TAB: TabId = "inspect";

const TAB_PARAM = "tab";
const SRC_PARAM = "src";

export function isTabId(value: string | null | undefined): value is TabId {
  return !!value && (TAB_IDS as readonly string[]).includes(value);
}

/** The tab named in the current URL, or null when it names none (or names one that doesn't exist). */
export function readTabFromUrl(): TabId | null {
  const value = new URL(window.location.href).searchParams.get(TAB_PARAM);
  return isTabId(value) ? value : null;
}

/**
 * The remote source URL in the current URL, if any. Only http(s) is accepted: anything else is
 * either unfetchable or a scheme (blob:, data:, javascript:) we should not follow from a link
 * someone else wrote.
 */
export function readSrcFromUrl(): string | null {
  const value = new URL(window.location.href).searchParams.get(SRC_PARAM);
  if (!value) return null;
  try {
    const parsed = new URL(value, window.location.href);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : null;
  } catch {
    return null;
  }
}

function writeParam(name: string, value: string | null, push: boolean): void {
  const url = new URL(window.location.href);
  if (value === null) url.searchParams.delete(name);
  else url.searchParams.set(name, value);
  const next = url.pathname + url.search + url.hash;
  // Tab clicks push, so browser back/forward walks the tabs the way the tab bar implies; anything
  // the app decides on its own replaces, to avoid history entries the user never asked for.
  if (push) window.history.pushState({}, "", next);
  else window.history.replaceState({}, "", next);
}

/** Records the active tab. `push` adds a history entry (use it for a click, not for a restore). */
export function writeTabToUrl(tab: TabId, push: boolean): void {
  if (readTabFromUrl() === tab) return;
  writeParam(TAB_PARAM, tab, push);
}

/** Records (or, with null, clears) the remote source URL. Never adds a history entry. */
export function writeSrcToUrl(src: string | null): void {
  writeParam(SRC_PARAM, src, false);
}
