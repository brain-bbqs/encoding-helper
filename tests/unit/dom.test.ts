import {
  installExecCommand,
  stubClipboard,
  type ClipboardStub,
  type ExecCommandStub,
} from "@brain-bbqs/test-utils/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { button, copyToClipboard, escapeHtml, resetIcon } from "@brain-bbqs/ui";
import { closeInfoPopovers, cmdBlock, dataTable, fold, gridItem, infoIcon, section, teachBox } from "../../src/lib/dom";
import { setEducationalEnabled } from "../../src/lib/educational";

// The generic helpers come from @brain-bbqs/ui, whose own tests cover them; what is pinned here is
// what this app relies on and the package's tests leave open.
describe("escapeHtml", () => {
  it("leaves ordinary tag names alone", () => {
    expect(escapeHtml("©too")).toBe("©too");
  });
});

describe("gridItem", () => {
  it("renders a plain label and value with no info affordance", () => {
    const item = gridItem("Duration", "12.5 s");
    expect(item.querySelector("label")?.textContent).toBe("Duration");
    expect(item.querySelector(".val")?.textContent).toBe("12.5 s");
    expect(item.querySelector(".info")).toBeNull();
  });

  it("adds an info button as a sibling of the label, not a child of it", () => {
    const item = gridItem("Container", "MP4", { info: "<b>MP4</b> is a container." });
    const label = item.querySelector("label");
    expect(label?.querySelector(".info")).toBeNull();
    expect(item.querySelector(".item-head .info-btn")?.getAttribute("aria-label")).toBe("About Container");
    expect(item.querySelector(".info-pop")?.innerHTML).toBe("<b>MP4</b> is a container.");
  });

  it("shrinks the value when asked to", () => {
    expect(gridItem("Codec", "avc1.640020", { sm: true }).querySelector(".val")?.className).toBe("val sm");
  });

  it("keeps raw tag names out of the uppercase label styling", () => {
    expect(gridItem("©too", "Lavf60.16.100", { rawLabel: true }).querySelector("label")?.className).toBe("raw");
    expect(gridItem("Duration", "12.5 s").querySelector("label")?.className).toBe("");
  });
});

describe("infoIcon", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("toggles open on click and reports the state to assistive tech", () => {
    const icon = infoIcon("Explainer");
    document.body.append(icon);
    const btn = icon.querySelector<HTMLButtonElement>(".info-btn");

    btn?.click();
    expect(icon.classList.contains("open")).toBe(true);
    expect(btn?.getAttribute("aria-expanded")).toBe("true");

    btn?.click();
    expect(icon.classList.contains("open")).toBe(false);
    expect(btn?.getAttribute("aria-expanded")).toBe("false");
  });

  it("closes on a click elsewhere in the document", () => {
    const icon = infoIcon("Explainer");
    document.body.append(icon);
    icon.querySelector<HTMLButtonElement>(".info-btn")?.click();
    expect(icon.classList.contains("open")).toBe(true);

    document.body.click();
    expect(icon.classList.contains("open")).toBe(false);
  });

  it("stays open when the popover itself is clicked", () => {
    const icon = infoIcon('Explainer with a <a href="#x">link</a>');
    document.body.append(icon);
    icon.querySelector<HTMLButtonElement>(".info-btn")?.click();

    icon.querySelector<HTMLElement>(".info-pop")?.click();
    expect(icon.classList.contains("open")).toBe(true);
  });

  it("closes on Escape but not on any other key", () => {
    const icon = infoIcon("Explainer");
    document.body.append(icon);
    icon.querySelector<HTMLButtonElement>(".info-btn")?.click();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(icon.classList.contains("open")).toBe(true);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(icon.classList.contains("open")).toBe(false);
    expect(icon.querySelector(".info-btn")?.getAttribute("aria-expanded")).toBe("false");
  });

  /** Two icons in the page, the first opened and then the second. */
  function openFirstThenSecond(): { first: HTMLElement; second: HTMLElement } {
    const first = infoIcon("One");
    const second = infoIcon("Two");
    document.body.append(first, second);
    first.querySelector<HTMLButtonElement>(".info-btn")?.click();
    second.querySelector<HTMLButtonElement>(".info-btn")?.click();
    return { first, second };
  }

  it("opens the second icon while closing the first", () => {
    const { first, second } = openFirstThenSecond();
    expect(first.classList.contains("open")).toBe(false);
    expect(first.querySelector(".info-btn")?.getAttribute("aria-expanded")).toBe("false");
    expect(second.classList.contains("open")).toBe(true);
    expect(second.querySelector(".info-btn")?.getAttribute("aria-expanded")).toBe("true");
  });

  it("closes every open popover at once", () => {
    const { first, second } = openFirstThenSecond();
    // Opening the second one already dismissed the first.
    expect(first.classList.contains("open")).toBe(false);

    closeInfoPopovers();
    expect(second.classList.contains("open")).toBe(false);
    expect(second.querySelector(".info-btn")?.getAttribute("aria-expanded")).toBe("false");
  });

  // jsdom lays nothing out, so these stand in for the browser: a viewport, a 14px ⓘ at a given spot,
  // and a popover that has no box while the stylesheet hides it and, once laid out, is `popWidth`
  // wide and hangs 10px past the icon on the side it opens from, as src/style.css places it.
  describe("placement", () => {
    const ICON_PX = 14;
    const OFFSET_PX = 10;

    interface Layout {
      viewport: number;
      /** The viewport less its vertical scrollbar, where it has one. */
      clientWidth?: number;
      iconLeft: number;
      iconBottom?: number;
      popWidth: number;
    }

    let sheet: HTMLStyleElement;

    beforeEach(() => {
      sheet = document.createElement("style");
      sheet.textContent = ".info-pop { display: none; } .info.open .info-pop { display: block; }";
      document.head.append(sheet);
    });

    afterEach(() => {
      sheet.remove();
      vi.restoreAllMocks();
    });

    /** An icon in the page laid out as `layout` says, read afresh at each placement, and the
     * popover's visibility at each read of its box. */
    function placedIcon(layout: Layout): { icon: HTMLElement; pop: HTMLElement; reads: string[] } {
      vi.spyOn(window, "innerWidth", "get").mockImplementation(() => layout.viewport);
      vi.spyOn(window, "innerHeight", "get").mockReturnValue(800);
      vi.spyOn(document.documentElement, "clientWidth", "get").mockImplementation(
        () => layout.clientWidth ?? layout.viewport,
      );
      const icon = infoIcon("Explainer");
      document.body.append(icon);
      const btn = icon.querySelector<HTMLElement>(".info-btn");
      const pop = icon.querySelector<HTMLElement>(".info-pop");
      if (!btn || !pop) throw new Error("infoIcon drew no button or popover");
      vi.spyOn(btn, "getBoundingClientRect").mockImplementation(
        () => new DOMRect(layout.iconLeft, (layout.iconBottom ?? 100) - ICON_PX, ICON_PX, ICON_PX),
      );
      const reads: string[] = [];
      vi.spyOn(pop, "getBoundingClientRect").mockImplementation(() => {
        const style = getComputedStyle(pop);
        if (style.display === "none") return new DOMRect();
        reads.push(style.visibility);
        const left = icon.classList.contains("flip-x")
          ? layout.iconLeft + ICON_PX + OFFSET_PX - layout.popWidth
          : layout.iconLeft - OFFSET_PX;
        return new DOMRect(left, 0, layout.popWidth, 100);
      });
      return { icon, pop, reads };
    }

    function hover(icon: HTMLElement): void {
      icon.dispatchEvent(new MouseEvent("mouseenter"));
    }

    it("opens rightward when the popover fits there", () => {
      const { icon } = placedIcon({ viewport: 1280, iconLeft: 200, popWidth: 340 });
      hover(icon);
      expect(icon.classList.contains("flip-x")).toBe(false);
    });

    it("opens leftward when only that side fits, and rightward again once it fits there", () => {
      const layout: Layout = { viewport: 1280, iconLeft: 1100, popWidth: 340 };
      const { icon } = placedIcon(layout);
      hover(icon);
      expect(icon.classList.contains("flip-x")).toBe(true);

      // Placed again where it stands, it is measured rightward afresh rather than from the flipped box.
      hover(icon);
      expect(icon.classList.contains("flip-x")).toBe(true);

      layout.iconLeft = 200;
      hover(icon);
      expect(icon.classList.contains("flip-x")).toBe(false);
    });

    it("opens rightward when the popover ends exactly at the viewport's edge", () => {
      // 940 to 1280 of 1280.
      const { icon } = placedIcon({ viewport: 1280, iconLeft: 950, popWidth: 340 });
      hover(icon);
      expect(icon.classList.contains("flip-x")).toBe(false);
    });

    it("keeps a short popover near the right edge opening rightward when it fits", () => {
      // 990 to 1190 of 1280.
      const { icon } = placedIcon({ viewport: 1280, iconLeft: 1000, popWidth: 200 });
      hover(icon);
      expect(icon.classList.contains("flip-x")).toBe(false);
    });

    it("opens rightward on a phone when the popover fits there", () => {
      // 70vw of a 390px phone caps the popover at 273px, which from an icon at 100 spans 90 to 363.
      const { icon } = placedIcon({ viewport: 390, iconLeft: 100, popWidth: 273 });
      hover(icon);
      expect(icon.classList.contains("flip-x")).toBe(false);
    });

    it("opens toward the roomier side when the popover fits on neither", () => {
      // From an icon at 150 the right has 250px and the left 174; from one at 220, 180 and 244.
      const layout: Layout = { viewport: 390, iconLeft: 150, popWidth: 273 };
      const { icon } = placedIcon(layout);
      hover(icon);
      expect(icon.classList.contains("flip-x")).toBe(false);

      layout.iconLeft = 220;
      hover(icon);
      expect(icon.classList.contains("flip-x")).toBe(true);
    });

    it("opens rightward when the popover fits on neither side and both have the same room", () => {
      // From an icon at 188 both sides have 212px.
      const { icon } = placedIcon({ viewport: 390, iconLeft: 188, popWidth: 273 });
      hover(icon);
      expect(icon.classList.contains("flip-x")).toBe(false);
    });

    it("keeps the popover out from under a vertical scrollbar", () => {
      // 930 to 1270 fits 1280px, but not the 1265 a 15px scrollbar leaves.
      const { icon } = placedIcon({ viewport: 1280, clientWidth: 1265, iconLeft: 940, popWidth: 340 });
      hover(icon);
      expect(icon.classList.contains("flip-x")).toBe(true);
    });

    it("measures the popover unseen and leaves showing it to the stylesheet", () => {
      const { icon, pop, reads } = placedIcon({ viewport: 1280, iconLeft: 1100, popWidth: 340 });
      hover(icon);
      expect(reads).not.toHaveLength(0);
      expect(reads.filter((visibility) => visibility !== "hidden")).toEqual([]);
      expect(pop.style.cssText).toBe("");
      expect(getComputedStyle(pop).display).toBe("none");

      icon.querySelector<HTMLButtonElement>(".info-btn")?.click();
      expect(getComputedStyle(pop).display).toBe("block");
      expect(getComputedStyle(pop).visibility).toBe("visible");
    });

    it("opens upward once the icon sits below 55% of the viewport's height", () => {
      // 55% of the 800px viewport is 440.
      const layout: Layout = { viewport: 1280, iconLeft: 200, iconBottom: 440, popWidth: 340 };
      const { icon } = placedIcon(layout);
      hover(icon);
      expect(icon.classList.contains("above")).toBe(false);

      layout.iconBottom = 441;
      hover(icon);
      expect(icon.classList.contains("above")).toBe(true);
    });
  });
});

describe("fold", () => {
  it("starts closed, with the bar carrying the label and an empty note slot", () => {
    const { wrap, body } = fold("Sampled timestamps");
    body.append(document.createElement("table"));
    expect(wrap.open).toBe(false);
    expect(wrap.querySelector("summary")?.textContent).toBe("Sampled timestamps");
    expect(wrap.querySelector(".fold-note")?.textContent).toBe("");
    expect(wrap.querySelector(".fold-body")?.firstElementChild?.tagName).toBe("TABLE");
  });

  it("hands back the bar's note slot for the caller to fill", () => {
    const { wrap, note } = fold("Details");
    const btn = document.createElement("button");
    note.append(btn);
    expect(wrap.querySelector("summary .fold-note button")).toBe(btn);
  });
});

// The ⓘ and the teach boxes are built whatever the Educational switch says, marked for the
// stylesheet to hide while it is off, so a flip never has to draw a panel again.
describe("with the educational toggle off", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    setEducationalEnabled(false);
  });

  afterEach(() => {
    setEducationalEnabled(true);
  });

  it("builds the info icon in full, marked as teaching material", () => {
    const icon = infoIcon("Explainer");
    expect(icon.className).toBe("info edu");
    expect(icon.querySelector(".info-btn")?.getAttribute("aria-label")).toBe("More information");
    expect(icon.querySelector(".info-pop")?.innerHTML).toBe("Explainer");
  });

  it("builds the teach box in full, marked as teaching material", () => {
    const box = teachBox("<b>Chroma</b>", "🎨");
    expect(box.className).toBe("teach edu");
    expect(box.querySelector(".teach-body")?.innerHTML).toBe("<b>Chroma</b>");
  });
});

describe("teachBox", () => {
  it("carries the gutter mark and the explainer markup", () => {
    const box = teachBox("<b>Chroma</b> subsampling", "🎨");
    expect(box.querySelector(".teach-icon")?.textContent).toBe("🎨");
    expect(box.querySelector(".teach-icon")?.getAttribute("aria-hidden")).toBe("true");
    expect(box.querySelector(".teach-body")?.innerHTML).toBe("<b>Chroma</b> subsampling");
  });
});

describe("dataTable", () => {
  it("lays the headers and rows out as text cells inside a scroller", () => {
    const scroll = dataTable(
      ["Time", "Bytes"],
      [
        ["0.0", "12"],
        ["1.0", "34"],
      ],
    );
    expect(scroll.className).toBe("scroll-x");
    expect(Array.from(scroll.querySelectorAll("th")).map((th) => th.textContent)).toEqual(["Time", "Bytes"]);
    expect(Array.from(scroll.querySelectorAll("tbody tr")).map((tr) => tr.textContent)).toEqual(["0.012", "1.034"]);
  });
});

describe("resetIcon", () => {
  it("draws the reset mark at the asked size in the current colour", () => {
    const icon = resetIcon(20);
    expect(icon.getAttribute("width")).toBe("20");
    expect(icon.getAttribute("stroke")).toBe("currentColor");
    expect(icon.querySelector("path")).not.toBeNull();
    expect(resetIcon().getAttribute("height")).toBe("14");
  });
});

describe("section", () => {
  it("starts a card with its heading", () => {
    const sec = section("Metadata");
    expect(sec.className).toBe("section");
    expect(sec.querySelector("h2")?.textContent).toBe("Metadata");
  });
});

/** Lets the clipboard promise settle either way, without waiting on a real timer. */
async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) await Promise.resolve();
}

describe("clipboard", () => {
  let writeText: ReturnType<typeof vi.fn>;
  let execCommand: ReturnType<typeof vi.fn>;
  let clipboard: ClipboardStub;
  let execCommandStub: ExecCommandStub;

  beforeEach(() => {
    document.body.innerHTML = "";
    vi.useFakeTimers();
    writeText = vi.fn();
    clipboard = stubClipboard(writeText);
    // jsdom has no execCommand at all; the fallback path needs one to call.
    execCommand = vi.fn(() => true);
    execCommandStub = installExecCommand(execCommand);
  });

  afterEach(() => {
    execCommandStub.restore();
    clipboard.restore();
    vi.useRealTimers();
  });

  it("copies the command from its block and says so for a moment", async () => {
    writeText.mockResolvedValue(undefined);
    const { wrap, pre } = cmdBlock("ffmpeg -i in.mp4 out.mp4");
    document.body.append(wrap);
    pre.textContent = "ffmpeg -i in.mp4 -crf 25 out.mp4";
    const btn = wrap.querySelector<HTMLButtonElement>(".cmd-copy")!;
    expect(btn.getAttribute("aria-label")).toBe("Copy command");

    btn.click();
    await settle();
    expect(writeText.mock.calls[0][0]).toBe("ffmpeg -i in.mp4 -crf 25 out.mp4");
    expect(btn.classList.contains("copied")).toBe(true);
    expect(execCommand).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1400);
    expect(btn.classList.contains("copied")).toBe(false);
  });

  it("copies an empty block as an empty string", async () => {
    writeText.mockResolvedValue(undefined);
    const { wrap } = cmdBlock();
    document.body.append(wrap);
    wrap.querySelector<HTMLButtonElement>(".cmd-copy")!.click();
    await settle();
    expect(writeText.mock.calls[0][0]).toBe("");
  });

  // Where the clipboard API is refused (an insecure context, a denied permission), the text goes
  // through a hidden textarea and the old copy command instead, and the block still says "copied".
  it("falls back to a hidden textarea when the clipboard API refuses", async () => {
    writeText.mockRejectedValue(new Error("denied"));
    const { wrap } = cmdBlock("ffmpeg -version");
    document.body.append(wrap);
    const btn = wrap.querySelector<HTMLButtonElement>(".cmd-copy")!;

    btn.click();
    await settle();
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(btn.classList.contains("copied")).toBe(true);
    // The scratch textarea is gone again once the copy is done.
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("relabels a copy button and puts its label back afterwards", async () => {
    writeText.mockResolvedValue(undefined);
    const btn = button("btn", "Copy Markdown");
    copyToClipboard("# Title", btn);
    await settle();
    expect(writeText.mock.calls[0][0]).toBe("# Title");
    expect(btn.textContent).toBe("Copied!");

    vi.advanceTimersByTime(1399);
    expect(btn.textContent).toBe("Copied!");
    vi.advanceTimersByTime(1);
    expect(btn.textContent).toBe("Copy Markdown");
  });
});
