import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  button,
  closeInfoPopovers,
  cmdBlock,
  copyToClipboard,
  dataTable,
  escapeHtml,
  fold,
  gridItem,
  infoIcon,
  resetIcon,
  section,
  svgEl,
  svgText,
  teachBox,
} from "../../src/lib/dom";
import { setEducationalEnabled } from "../../src/lib/educational";

describe("escapeHtml", () => {
  it("escapes every character that could break out of an attribute or element", () => {
    expect(escapeHtml(`<img src="x" onerror='alert(1)'>&`)).toBe(
      "&lt;img src=&quot;x&quot; onerror=&#39;alert(1)&#39;&gt;&amp;",
    );
  });

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

  it("closes every open popover at once", () => {
    const first = infoIcon("One");
    const second = infoIcon("Two");
    document.body.append(first, second);
    first.querySelector<HTMLButtonElement>(".info-btn")?.click();
    second.querySelector<HTMLButtonElement>(".info-btn")?.click();
    // Opening the second one already dismissed the first.
    expect(first.classList.contains("open")).toBe(false);

    closeInfoPopovers();
    expect(second.classList.contains("open")).toBe(false);
    expect(second.querySelector(".info-btn")?.getAttribute("aria-expanded")).toBe("false");
  });
});

describe("fold", () => {
  it("starts closed, with the bar carrying the label and its note", () => {
    const { wrap, body } = fold("Sampled timestamps", "100 rows");
    body.append(document.createElement("table"));
    expect(wrap.open).toBe(false);
    expect(wrap.querySelector("summary")?.textContent).toBe("Sampled timestamps100 rows");
    expect(wrap.querySelector(".fold-note")?.textContent).toBe("100 rows");
    expect(wrap.querySelector(".fold-body")?.firstElementChild?.tagName).toBe("TABLE");
  });

  it("leaves the note empty when there is nothing to say about what is inside", () => {
    expect(fold("Details").wrap.querySelector(".fold-note")?.textContent).toBe("");
  });
});

describe("infoIcon dismissal", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
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

  it("opens the second icon while closing the first", () => {
    const first = infoIcon("One");
    const second = infoIcon("Two");
    document.body.append(first, second);
    first.querySelector<HTMLButtonElement>(".info-btn")?.click();
    second.querySelector<HTMLButtonElement>(".info-btn")?.click();
    expect(first.classList.contains("open")).toBe(false);
    expect(first.querySelector(".info-btn")?.getAttribute("aria-expanded")).toBe("false");
    expect(second.classList.contains("open")).toBe(true);
    expect(second.querySelector(".info-btn")?.getAttribute("aria-expanded")).toBe("true");
  });
});

// The ⓘ and the teach boxes go with the Educational switch, and stay in the tree as empty, hidden
// nodes so their call sites can keep appending them unconditionally.
describe("with the educational toggle off", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    setEducationalEnabled(false);
  });

  afterEach(() => {
    setEducationalEnabled(true);
  });

  it("renders the info icon as an empty hidden span", () => {
    const icon = infoIcon("Explainer");
    expect(icon.className).toBe("info edu-off");
    expect(icon.querySelector(".info-btn")).toBeNull();
    expect(icon.textContent).toBe("");
  });

  it("renders the teach box empty and hidden", () => {
    const box = teachBox("<b>Chroma</b>", "🎨");
    expect(box.className).toBe("teach edu-off");
    expect(box.children).toHaveLength(0);
  });
});

describe("teachBox", () => {
  it("carries the gutter mark and the explainer markup", () => {
    const box = teachBox("<b>Chroma</b> subsampling", "🎨");
    expect(box.querySelector(".teach-icon")?.textContent).toBe("🎨");
    expect(box.querySelector(".teach-icon")?.getAttribute("aria-hidden")).toBe("true");
    expect(box.querySelector(".teach-body")?.innerHTML).toBe("<b>Chroma</b> subsampling");
  });

  it("marks an unspecific box with the same bulb the Educational switch carries", () => {
    expect(teachBox("Anything").querySelector(".teach-icon")?.textContent).toBe("💡");
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

describe("svg helpers", () => {
  it("builds namespaced elements with their attributes and text", () => {
    const text = svgText("axis", { x: 4, y: "8" }, "0 s");
    expect(text.namespaceURI).toBe("http://www.w3.org/2000/svg");
    expect(text.getAttribute("class")).toBe("axis");
    expect(text.getAttribute("x")).toBe("4");
    expect(text.textContent).toBe("0 s");
    expect(svgEl("g").attributes).toHaveLength(0);
  });

  it("draws the reset mark at the asked size in the current colour", () => {
    const icon = resetIcon(20);
    expect(icon.getAttribute("width")).toBe("20");
    expect(icon.getAttribute("stroke")).toBe("currentColor");
    expect(icon.querySelector("path")).not.toBeNull();
    expect(resetIcon().getAttribute("height")).toBe("14");
  });
});

describe("section and button", () => {
  it("starts a card with its heading and makes buttons that never submit", () => {
    expect(section("Metadata").querySelector("h2")?.textContent).toBe("Metadata");
    const b = button("btn", "Run");
    expect(b.type).toBe("button");
    expect(b.textContent).toBe("Run");
  });
});

/** Lets the clipboard promise settle either way, without waiting on a real timer. */
async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) await Promise.resolve();
}

describe("clipboard", () => {
  let writeText: ReturnType<typeof vi.fn>;
  let execCommand: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    document.body.innerHTML = "";
    vi.useFakeTimers();
    writeText = vi.fn();
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    // jsdom has no execCommand at all; the fallback path needs one to call.
    execCommand = vi.fn(() => true);
    Object.defineProperty(document, "execCommand", { value: execCommand, configurable: true });
  });

  afterEach(() => {
    delete (document as Partial<Document>).execCommand;
    vi.unstubAllGlobals();
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
