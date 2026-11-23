/**
 * Wraps a story element in a centered container, 640px at most, so components
 * render at a fixed width against the app background.
 */
export function withCard(element: HTMLElement): HTMLDivElement {
  const wrapper = document.createElement("div");
  wrapper.style.maxWidth = "640px";
  wrapper.style.margin = "1.5rem auto";
  wrapper.appendChild(element);
  return wrapper;
}
