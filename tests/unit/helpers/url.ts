// The address bar as the deployed app sees it. Imports nothing, so no test file's vi.mock reaches it.

/** Puts the page at the app's base path with `search` as its query string ("" for none). */
export function setUrl(search: string): void {
  window.history.replaceState({}, "", "/encoding-helper/" + search);
}
