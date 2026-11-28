// ffmpeg.wasm and the save picker are stubbed: what this section does is drive the engine with the
// command the tab above it built, keep the box's bar, log and note in step, and put the output
// wherever the reader chose to save it.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetCliDefaults } from "../fixtures/state";
import { encoderBusy } from "../../src/lib/encoderRun";
import { cli, resetState, state } from "../../src/lib/state";
import type { VideoInfo } from "../../src/lib/types";
import type { EngineBox } from "../../src/ui/formControls";
import { inBrowserEncodeSection, showReencodeResult } from "../../src/ui/inBrowserEncode";
import { deferred, flush } from "./helpers/async";

const ensureFfmpegLoaded = vi.hoisted(() => vi.fn());
const runFfmpegEncode = vi.hoisted(() => vi.fn());
const setFfmpegHandlers = vi.hoisted(() => vi.fn());
const pickSaveTarget = vi.hoisted(() => vi.fn());
const downloadBlob = vi.hoisted(() => vi.fn());
const fetchFile = vi.hoisted(() => vi.fn());

/** The core the whole-file encode runs on, which a file load or Reset terminates to stop it. */
const defaultFfmpegWorker = vi.hoisted(() => ({ reset: vi.fn() }));

vi.mock("../../src/lib/ffmpegEngine", () => ({
  ensureFfmpegLoaded,
  runFfmpegEncode,
  setFfmpegHandlers,
  defaultFfmpegWorker,
}));
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

  // The bar is the encode's progress, so it shows from the press, emptied of the encode before it,
  // and goes again once the encode is over.
  it("shows the bar from the press, emptied of the last encode's", async () => {
    const { button, el } = section();
    const bar = el.querySelector<HTMLElement>(".progress-wrap")!;
    const fill = el.querySelector<HTMLElement>(".fill")!;
    fill.style.width = "100%";
    fill.classList.add("done");

    // Read before the encode's first wait, so this is the bar as the press left it.
    button.click();

    expect(bar.style.display).toBe("block");
    expect(fill.style.width).toBe("0%");
    expect(fill.classList.contains("done")).toBe(false);
    await vi.waitFor(() => expect(button.disabled).toBe(false));
    expect(bar.style.display).toBe("none");
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

  // The whole-file encode shares the cores with every other run, so it takes its turn like they do:
  // a press while another encode holds them is refused, says why, and leaves the button usable.
  it("refuses to start while another encode is running, and says why", async () => {
    const encoding = deferred<{ data: Uint8Array }>();
    runFfmpegEncode.mockReturnValueOnce(encoding.promise);
    const first = section();
    // A second section, standing in for any other control that takes the encoder (the runs on the
    // other tabs are pressed against this one in compareTab's tests).
    const second = section();
    first.button.click();
    await vi.waitFor(() => expect(runFfmpegEncode).toHaveBeenCalledOnce());

    second.button.click();
    await flush();

    expect(runFfmpegEncode).toHaveBeenCalledOnce();
    expect(second.note.textContent).toBe(
      "An encode is already running on the Reencode with FFmpeg tab. Wait for it to finish.",
    );
    expect(second.button.disabled).toBe(false);

    encoding.resolve({ data: new Uint8Array(1000) });
    await vi.waitFor(() => expect(first.button.disabled).toBe(false));
    await run(second.button);
    expect(runFfmpegEncode).toHaveBeenCalledTimes(2);
  });

  // The engine fails a core load that a file load or Reset lands in, so the encode never reaches the
  // read then; the check before the read is the backstop for a load that comes back all the same.
  it("reads nothing of the file once stopped, even by a core load that comes back", async () => {
    ensureFfmpegLoaded.mockImplementationOnce(() => {
      resetState();
      return Promise.resolve();
    });
    const { button, note } = section();

    await run(button);

    expect(fetchFile).not.toHaveBeenCalled();
    expect(runFfmpegEncode).not.toHaveBeenCalled();
    expect(note.textContent).toBe("Stopped.");
    expect(encoderBusy()).toBe(false);
  });

  // A file load or Reset stops the encode. The engine's delete of the input swallows the stopped
  // core's failure, so the encode can still come back as if it had finished: nothing is saved.
  it("saves nothing when the file is closed as the encode comes back", async () => {
    const encoding = deferred<{ data: Uint8Array }>();
    runFfmpegEncode.mockReturnValueOnce(encoding.promise);
    const { button, note } = section();
    button.click();
    await vi.waitFor(() => expect(runFfmpegEncode).toHaveBeenCalledOnce());

    resetState();
    encoding.resolve({ data: new Uint8Array(1000) });
    await vi.waitFor(() => expect(button.disabled).toBe(false));

    expect(defaultFfmpegWorker.reset).toHaveBeenCalledOnce();
    expect(pickSaveTarget).not.toHaveBeenCalled();
    expect(downloadBlob).not.toHaveBeenCalled();
    expect(state.reencodeResult).toBeNull();
    expect(note.textContent).toBe("Stopped.");
    expect(encoderBusy()).toBe(false);
  });

  // Closed while the output is being written to the file the reader picked, the saving is not
  // recorded for Full Analysis, whose state is the next file's by then.
  it("records nothing for the next file when the file is closed while the output is saved", async () => {
    const writing = deferred<void>();
    const writable = { write: vi.fn().mockReturnValue(writing.promise), close: vi.fn().mockResolvedValue(undefined) };
    pickSaveTarget.mockResolvedValue({ kind: "stream", writable });
    const { button, note } = section();
    button.click();
    await vi.waitFor(() => expect(writable.write).toHaveBeenCalledOnce());

    resetState();
    writing.resolve();
    await vi.waitFor(() => expect(button.disabled).toBe(false));

    expect(state.reencodeResult).toBeNull();
    expect(note.textContent).toBe("Stopped.");
    expect(encoderBusy()).toBe(false);
  });
});

describe("showReencodeResult", () => {
  function box(): EngineBox {
    const note = document.createElement("div");
    note.textContent = "Encoding…";
    const result = document.createElement("div");
    result.innerHTML = "<p>old</p>";
    return { note, result } as unknown as EngineBox;
  }

  it("reports the sizes and the change, and records the encode for the analysis document", () => {
    const b = box();
    showReencodeResult(b, 2_000_000, 500_000);
    const vals = Array.from(b.result.querySelectorAll(".val")).map((v) => v.textContent);
    expect(vals).toEqual(["1.9 MB", "488.3 KB", "-75% (original 4.0× larger)"]);
    expect(b.note.textContent).toBe("");
    expect(state.reencodeResult).toEqual({ originalSize: 2_000_000, encodedSize: 500_000 });
  });

  // The change is a share of the original, so with nothing to take a share of there is no figure.
  it("states no change when there was no original size to divide by", () => {
    const b = box();
    showReencodeResult(b, 0, 500);
    const change = Array.from(b.result.querySelectorAll(".val")).map((v) => v.textContent)[2];
    expect(change).toBe("–");
  });
});
