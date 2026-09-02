// Shareable app state in the address bar.
//
// Four things live in the query string: `tab`, so a link points at the panel the sender was looking
// at; `src`, the remote video URL when the file was loaded from one; `edu`, whether the Educational
// switch is on, so a link can point someone at the app with its explainers already hidden (or
// shown); and `demos`, a bare flag standing for the demo-file page in place of the file picker.
// Local files can never be shared this way (the browser gives no readable path, and the recipient
// would not have the file), so loading one clears `src`.

// "analysis" is the Full Analysis document, reached from the button beside the tab row rather than
// from a tab, but it is a place the app can be in and so is linkable like the rest.
const TAB_IDS = ["inspect", "encode", "compare", "analysis"] as const;

export type TabId = (typeof TAB_IDS)[number];

export const DEFAULT_TAB: TabId = "inspect";

/**
 * Tabs that no longer exist, and where their content went.
 *
 * A link someone sent still points at a place in the app, so it opens there rather than falling
 * back to the default tab: the atom map and the seeking test are sections of Inspect now, and the
 * in-browser encode is a section of the command builder's tab.
 */
const LEGACY_TAB_IDS: Record<string, TabId> = {
  atoms: "inspect",
  seek: "inspect",
  reencode: "encode",
};

const TAB_PARAM = "tab";
const SRC_PARAM = "src";
const EDU_PARAM = "edu";
const DEMOS_PARAM = "demos";

export function isTabId(value: string | null | undefined): value is TabId {
  return !!value && (TAB_IDS as readonly string[]).includes(value);
}

/** The tab named in the current URL, or null when it names none (or names one that doesn't exist).
 * A retired tab's name resolves to the tab its content moved to. */
export function readTabFromUrl(): TabId | null {
  const value = currentParams().get(TAB_PARAM);
  if (isTabId(value)) return value;
  return (value ? LEGACY_TAB_IDS[value] : null) ?? null;
}

/**
 * The remote source URL in the current URL, if any. Only http(s) is accepted: anything else is
 * either unfetchable or a scheme (blob:, data:, javascript:) we should not follow from a link
 * someone else wrote.
 */
export function readSrcFromUrl(): string | null {
  const value = currentParams().get(SRC_PARAM);
  if (!value) return null;
  try {
    const parsed = new URL(value, window.location.href);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : null;
  } catch {
    return null;
  }
}

/** Whether the URL names an Educational state, or null when it says nothing (defer to localStorage). */
export function readEducationalFromUrl(): boolean | null {
  const value = currentParams().get(EDU_PARAM);
  if (value === "1") return true;
  if (value === "0") return false;
  return null;
}

function currentParams(): URLSearchParams {
  return new URL(window.location.href).searchParams;
}

/** Puts a new address in the bar. Tab clicks push, so browser back/forward walks the tabs the way the
 * tab bar implies; anything the app decides on its own replaces, to avoid history entries the user
 * never asked for. */
function commit(next: string, push: boolean): void {
  if (push) window.history.pushState({}, "", next);
  else window.history.replaceState({}, "", next);
}

function writeParam(name: string, value: string | null, push: boolean): void {
  const url = new URL(window.location.href);
  if (value === null) url.searchParams.delete(name);
  else url.searchParams.set(name, value);
  commit(url.pathname + url.search + url.hash, push);
}

/** Records the active tab. `push` adds a history entry (use it for a click, not for a restore).
 * Compared against what the URL literally says rather than what it resolves to, so a link naming a
 * retired tab is rewritten to the tab it landed on instead of being left as it was. */
export function writeTabToUrl(tab: TabId, push: boolean): void {
  if (currentParams().get(TAB_PARAM) === tab) return;
  writeParam(TAB_PARAM, tab, push);
}

/** Records (or, with null, clears) the remote source URL. Never adds a history entry. */
export function writeSrcToUrl(src: string | null): void {
  writeParam(SRC_PARAM, src, false);
}

/** Records the Educational switch's state. Never adds a history entry (see writeSrcToUrl). */
export function writeEducationalToUrl(on: boolean): void {
  writeParam(EDU_PARAM, on ? "1" : "0", false);
}

/**
 * Whether the URL asks for the demos page.
 *
 * It is a flag rather than a value, so its presence is what counts and a hand-typed `?demos` reads
 * the same as the `?demos` the toggle writes. `?demos=0` is honoured as an off switch so a link can
 * say "the app, not the demos" even when something else appended the parameter.
 */
export function readDemosFromUrl(): boolean {
  const params = currentParams();
  return params.has(DEMOS_PARAM) && params.get(DEMOS_PARAM) !== "0";
}

/**
 * Records whether the demos page is up, written bare (`?demos`) and first in the query string,
 * since that is the address someone would type. `push` adds a history entry, so back leaves the
 * demos page the way it arrived — use it for a click on the toggle, not for restoring from a link.
 */
export function writeDemosToUrl(on: boolean, push: boolean): void {
  const url = new URL(window.location.href);
  url.searchParams.delete(DEMOS_PARAM);
  const rest = url.searchParams.toString();
  const search = on ? (rest ? `?${DEMOS_PARAM}&${rest}` : `?${DEMOS_PARAM}`) : rest ? `?${rest}` : "";
  const next = url.pathname + search + url.hash;
  if (next === window.location.pathname + window.location.search + window.location.hash) return;
  commit(next, push);
}
