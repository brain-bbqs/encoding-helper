// Whether the app's teaching material (the "teach" callout boxes and the ⓘ info-icon popovers next
// to grid fields) is shown at all. Persisted two ways: in localStorage, so the choice survives a
// reload, and in the `edu` URL parameter, so a link can point someone at the app with the switch
// already in a given position — the `?edu=` in the address bar wins over the stored value on load,
// the way `?tab=` wins over the last-visited tab. Defaults on, since a first-time visitor is exactly
// who the explainers are for.
//
// A single module-scoped flag rather than per-tab state: the toggle in the header is one control for
// every tab, matching how the theme toggle works, and the icon in front of it is the same icon used
// to mark the "Learn more about codec parameters" goal in the subtitle.

import { readEducationalFromUrl, writeEducationalToUrl } from "./appUrl";

const EDUCATIONAL_KEY = "encoding-helper.educational";

function readStored(): boolean {
  try {
    const raw = localStorage.getItem(EDUCATIONAL_KEY);
    return raw === null ? true : raw === "true";
  } catch {
    return true;
  }
}

let educational = readEducationalFromUrl() ?? readStored();

export function isEducationalEnabled(): boolean {
  return educational;
}

type Listener = (on: boolean) => void;
const listeners = new Set<Listener>();

/** Called whenever the toggle changes, so the UI can rebuild what depends on it. */
export function onEducationalChange(fn: Listener): void {
  listeners.add(fn);
}

export function setEducationalEnabled(on: boolean): void {
  if (on === educational) return;
  educational = on;
  try {
    localStorage.setItem(EDUCATIONAL_KEY, String(on));
  } catch {
    // Same best-effort handling as the theme toggle: a full localStorage or a privacy mode that
    // blocks it just means the choice doesn't survive a reload.
  }
  // Replaces rather than pushing a history entry: flipping the switch is a preference change, not a
  // place in the app to walk back to with the browser's back button (matches writeSrcToUrl).
  writeEducationalToUrl(on);
  listeners.forEach((fn) => fn(on));
}
