/**
 * Wraps a story element in a centered container so components render at a
 * realistic width against the app background, matching the real page shell.
 */
export function withCard(element: HTMLElement): HTMLDivElement {
  const wrapper = document.createElement("div");
  wrapper.style.maxWidth = "640px";
  wrapper.style.margin = "1.5rem auto";
  wrapper.appendChild(element);
  return wrapper;
}
