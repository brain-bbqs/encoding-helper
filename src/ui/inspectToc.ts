// The Inspect tab's "On this page" sidebar — a sticky right-hand table of contents linking to each
// section's `<h2>`, in the same shape pydata-sphinx-theme's docs use, with the current section
// picked out as you scroll. Inspect is the one tab long enough (metadata, atom map, GOP/seeking) for
// a reader to lose their place in, so it is the only tab that gets one.

import { h } from "../lib/dom";

function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "section"
  );
}

let scrollSpyObserver: IntersectionObserver | null = null;

/**
 * Wraps whatever renderInspectHead/renderAtomMap/renderInspectTail/renderSeekTab already appended to
 * `panel` into a content column, and builds the nav beside it from each top-level section's own
 * heading — so the list of links can never drift out of sync with what is actually on the page.
 * No-op (leaves the panel as-is) when there is nothing to link to, i.e. no file loaded yet.
 */
export function mountInspectToc(panel: HTMLElement): void {
  scrollSpyObserver?.disconnect();
  scrollSpyObserver = null;

  // A section's <h2> is usually its first child, but a card carrying the Educational toggle wraps
  // it in a .section-head row alongside that control instead.
  const headings = Array.from(
    panel.querySelectorAll<HTMLHeadingElement>(":scope > .section > h2, :scope > .section > .section-head > h2"),
  );
  if (!headings.length) return;

  const content = h("div", "inspect-content");
  content.append(...Array.from(panel.children));

  const used = new Set<string>();
  const list = h("ul");
  const links: HTMLAnchorElement[] = [];
  headings.forEach((hd) => {
    const label = hd.textContent || "Section";
    let id = slugify(label);
    let n = 2;
    while (used.has(id)) id = `${slugify(label)}-${n++}`;
    used.add(id);
    hd.id = id;

    const a = h("a", null, label);
    a.href = "#" + id;
    links.push(a);
    const li = h("li");
    li.append(a);
    list.append(li);
  });

  const nav = h("nav", "inspect-toc");
  nav.setAttribute("aria-label", "On this page");
  nav.append(h("div", "inspect-toc-title", "On this page"), list);

  const layout = h("div", "inspect-layout");
  layout.append(content, nav);
  panel.append(layout);

  const setActive = (id: string): void => {
    links.forEach((a) => a.classList.toggle("on", a.getAttribute("href") === "#" + id));
  };
  scrollSpyObserver = new IntersectionObserver(
    (entries) => {
      // The heading whose top is closest to (and above) the trigger line is the section being read;
      // scanning every heading each time keeps this correct even when several intersect at once.
      const above = headings.filter((hd) => hd.getBoundingClientRect().top <= 96);
      const current = above.length ? above[above.length - 1] : headings[0];
      if (entries.length) setActive(current.id);
    },
    { rootMargin: "-96px 0px -70% 0px", threshold: 0 },
  );
  headings.forEach((hd) => scrollSpyObserver?.observe(hd));
  setActive(headings[0].id);
}
