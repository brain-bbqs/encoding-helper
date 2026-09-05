// ffmpeg.wasm and the save picker are stubbed: what this section does is drive the engine with the
// command the tab above it built, keep the box's bar, log and note in step, and put the output
// wherever the reader chose to save it.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetCliDefaults } from "../fixtures/state";
import { cli, state } from "../../src/lib/state";
import type { VideoInfo } from "../../src/lib/types";
import { inBrowserEncodeSection } from "../../src/ui/inBrowserEncode";

const ensureFfmpegLoaded = vi.hoisted(() => vi.fn());
const runFfmpegEncode = vi.hoisted(() => vi.fn());
const setFfmpegHandlers = vi.hoisted(() => vi.fn());
const pickSaveTarget = vi.hoisted(() => vi.fn());
const downloadBlob = vi.hoisted(() => vi.fn());
const fetchFile = vi.hoisted(() => vi.fn());

vi.mock("../../src/lib/ffmpegEngine", () => ({ ensureFfmpegLoaded, runFfmpegEncode, setFfmpegHandlers }));
vi.mock("@ffmpeg/util", () => ({ fetchFile }));
vi.mock("../../src/lib/save", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/lib/save")>()),
  pickSaveTarget,
  downloadBlob,
}));

const INFO: VideoInfo = { fps: 30, width: 640, height: 480 };

function section(): {
  el: HTMLElement;
  button: HTMLButtonElement;
  note: HTMLElement;
  log: HTMLElement;
  result: HTMLElement;
} {
  const el = inBrowserEncodeSection(INFO);
  document.body.append(el);
  return {
    el,
    button: el.querySelector<HTMLButtonElement>("button.btn")!,
    note: el.querySelector<HTMLElement>(".progress-label")!,
    log: el.querySelector<HTMLElement>(".log-console")!,
    result: el.lastElementChild!.lastElementChild as HTMLElement,
  };
}

/** Clicks the button and waits for the run behind it to finish. */
async function run(button: HTMLButtonElement): Promise<void> {
  button.click();
  await vi.waitFor(() => expect(button.disabled).toBe(false));
}

beforeEach(() => {
  document.body.innerHTML = "";
  resetCliDefaults();
  vi.clearAllMocks();
  state.source = { kind: "file", name: "clip.mp4", size: 2_000_000 } as never;
  state.file = new File([new Uint8Array(8)], "clip.mp4");
  state.format = "MP4";
  fetchFile.mockResolvedValue(new Uint8Array(8));
  ensureFfmpegLoaded.mockResolvedValue(undefined);
  runFfmpegEncode.mockResolvedValue({ data: new Uint8Array(1000) });
  pickSaveTarget.mockResolvedValue({ kind: "buffer" });
});

afterEach(() => vi.restoreAllMocks());

describe("inBrowserEncodeSection", () => {
  it("names itself for what actually happens to this file", () => {
    expect(section().el.textContent).toContain("Reencode the Entire File Here");
    document.body.innerHTML = "";
    state.format = "MOV";
    // A file that comes back an MP4 having gone in as something else changed container.
    expect(section().el.textContent).toContain("Transcode the Entire File Here");
  });

  it("runs the command the builder above it produced", async () => {
    cli.quality = "custom";
    cli.crf = 28;
    const { button, log } = section();

    await run(button);

    const [args, inputName, , outputName] = runFfmpegEncode.mock.calls[0];
    expect(inputName).toBe("in.mp4");
    expect(outputName).toBe("video-reencoded.mp4");
    expect(args).toContain("-crf");
    expect(args[args.indexOf("-crf") + 1]).toBe("28");
    // Echoed into the log, so what ran is visible beside its output.
    expect(log.textContent).toContain("$ ffmpeg " + args.join(" "));
  });

  it("reads the loaded file rather than re-fetching it when there is one", async () => {
    const { button } = section();
    await run(button);
    expect(fetchFile).toHaveBeenCalledWith(state.file);
  });

  it("fetches the remote video when the file was loaded from a URL", async () => {
    state.file = null;
    state.source = { kind: "url", name: "clip.mp4", size: 10, url: "https://example.org/clip.mp4" } as never;
    const { button } = section();
    await run(button);
    expect(fetchFile).toHaveBeenCalledWith("https://example.org/clip.mp4");
  });

  it("reports the saving once the encode is done", async () => {
    const { button, result, note } = section();

    await run(button);

    expect(state.reencodeResult).toEqual({ originalSize: 2_000_000, encodedSize: 1000 });
    expect(result.textContent).toContain("Encoded Size");
    expect(note.textContent).toBe("");
  });

  it("writes straight to the file the reader picked", async () => {
    const writable = { write: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined) };
    pickSaveTarget.mockResolvedValue({ kind: "stream", writable });
    const { button } = section();

    await run(button);

    expect(pickSaveTarget).toHaveBeenCalledWith("clip-reencoded.mp4");
    expect(writable.write).toHaveBeenCalledOnce();
    expect(writable.close).toHaveBeenCalledOnce();
    expect(downloadBlob).not.toHaveBeenCalled();
  });

  it("downloads the output where there is no save picker to offer", async () => {
    const { button } = section();
    await run(button);
    expect(downloadBlob).toHaveBeenCalledWith(expect.any(Blob), "clip-reencoded.mp4");
  });

  it("downloads the output when the reader dismissed the picker", async () => {
    pickSaveTarget.mockResolvedValue(null);
    const { button } = section();
    await run(button);
    expect(downloadBlob).toHaveBeenCalledOnce();
  });

  it("advances the bar with the engine's progress, and logs what it says", async () => {
    const { button, el, log } = section();
    await run(button);
    const [onLog, onProgress] = setFfmpegHandlers.mock.calls[0];

    onLog("frame= 120 fps=30");
    onProgress(0.42);
    expect(log.textContent).toContain("frame= 120 fps=30");
    expect(el.querySelector<HTMLElement>(".fill")!.style.width).toBe("42%");

    // Clamped, since ffmpeg's ratio can overshoot on a file whose duration it misread.
    onProgress(1.4);
    expect(el.querySelector<HTMLElement>(".fill")!.style.width).toBe("100%");
    onProgress(-1);
    expect(el.querySelector<HTMLElement>(".fill")!.style.width).toBe("0%");
  });

  it("says what failed, in the note and in the log, and re-enables the button", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    runFfmpegEncode.mockRejectedValue(new Error("ffmpeg exited 1"));
    const { button, note, log } = section();

    await run(button);

    expect(note.textContent).toBe("Failed: ffmpeg exited 1");
    expect(log.textContent).toContain("ffmpeg exited 1");
    expect(button.disabled).toBe(false);
  });

  it("says so rather than running with nothing loaded", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    state.source = null;
    const { button, note } = section();

    await run(button);

    expect(note.textContent).toBe("Failed: No video loaded");
    expect(ensureFfmpegLoaded).not.toHaveBeenCalled();
  });

  it("clears the previous run's log and result before the next one", async () => {
    const { button, log, result } = section();
    await run(button);
    expect(result.textContent).not.toBe("");

    runFfmpegEncode.mockImplementation(() => {
      expect(log.textContent).toBe("");
      expect(result.innerHTML).toBe("");
      return Promise.resolve({ data: new Uint8Array(10) });
    });
    await run(button);
  });
});
