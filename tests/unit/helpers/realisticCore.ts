// A stand-in for @ffmpeg/ffmpeg 0.12.15's FFmpeg class that keeps the parts of its behaviour a
// stopped run's guards depend on, and records what each core was asked to do:
//
// - every call is posted to "the worker" and answered in a later macrotask (a message event);
// - terminate() rejects every call still pending with "called FFmpeg.terminate()", drops the worker
//   and its filesystem; a call made without a worker is refused ("ffmpeg is not loaded");
// - load() on an instance with no worker starts a fresh one, terminated or not (as the real one does);
// - each core has its own filesystem: an exec's output holds the bytes of its input, so what an
//   encode actually read can be traced back to whichever file was written into that core.
//
// Imports nothing, so a test file's vi.mock factory can import it.

export type CallKind = "load" | "writeFile" | "exec" | "readFile" | "deleteFile";

export interface CoreEvent {
  kind: "new" | "terminate" | CallKind;
  core: number;
  /** The path written/read/deleted, or the output of an exec. */
  path?: string;
  /** First byte of what was written, or of the input an exec read (null: input missing). */
  byte?: number | null;
  /** Whether the test had stopped or abandoned a run before this was posted. */
  afterStop: boolean;
  /** Which run the test says is going, for cases with a run after the stopped one. */
  phase: string;
  refused?: boolean;
}

export interface CoreControl {
  events: CoreEvent[];
  afterStop: boolean;
  phase: string;
  /** Holds a call until the returned promise settles; null answers it at once (next macrotask). */
  hold: ((kind: CallKind, core: number, path: string) => Promise<void> | null) | null;
  /** Holds the core download (toBlobURL) while set. */
  download: Promise<void> | null;
  /** How many cores have been constructed. */
  seq: number;
}

let messageId = 0;

export function makeFakeFFmpeg(c: CoreControl): new () => unknown {
  return class FakeFFmpeg {
    readonly id = ++c.seq;
    private worker = false;
    private pending = new Map<number, (err: Error) => void>();
    private fs = new Map<string, Uint8Array>();

    constructor() {
      c.events.push({ kind: "new", core: this.id, afterStop: c.afterStop, phase: c.phase });
    }

    on(): void {}

    private send<T>(kind: CallKind, path: string, byte: number | null | undefined, answer: () => T): Promise<T> {
      const event: CoreEvent = { kind, core: this.id, path, afterStop: c.afterStop, phase: c.phase };
      if (byte !== undefined) event.byte = byte;
      if (!this.worker) {
        c.events.push({ ...event, refused: true });
        return Promise.reject(new Error("ffmpeg is not loaded, call `await ffmpeg.load()` first"));
      }
      c.events.push(event);
      return new Promise<T>((resolve, reject) => {
        const id = ++messageId;
        this.pending.set(id, reject);
        // Answered as a message event would be: in a macrotask of its own, unless terminated first.
        const reply = (): void => {
          setTimeout(() => {
            if (!this.pending.delete(id)) return;
            try {
              resolve(answer());
            } catch (err) {
              reject(err as Error);
            }
          }, 0);
        };
        const held = c.hold?.(kind, this.id, path) ?? null;
        if (held) held.then(reply, (err: Error) => this.pending.delete(id) && reject(err));
        else reply();
      });
    }

    load(): Promise<boolean> {
      if (!this.worker) this.worker = true;
      return this.send("load", "", undefined, () => true);
    }

    terminate(): void {
      c.events.push({ kind: "terminate", core: this.id, afterStop: c.afterStop, phase: c.phase });
      for (const reject of this.pending.values()) reject(new Error("called FFmpeg.terminate()"));
      this.pending.clear();
      this.worker = false;
      this.fs.clear();
    }

    writeFile(path: string, data: Uint8Array): Promise<boolean> {
      // Posted with its buffer transferred, as the real client does.
      const copy = new Uint8Array(data);
      structuredClone(data, { transfer: [data.buffer as ArrayBuffer] });
      return this.send("writeFile", path, copy[0] ?? null, () => {
        this.fs.set(path, copy);
        return true;
      });
    }

    exec(args: string[]): Promise<number> {
      const input = args[args.indexOf("-i") + 1];
      const output = args[args.length - 1];
      const read = this.fs.get(input);
      return this.send("exec", output, read ? read[0] : null, () => {
        if (!read) throw new Error(`${input}: No such file or directory`);
        this.fs.set(output, new Uint8Array(read));
        return 0;
      });
    }

    readFile(path: string): Promise<Uint8Array> {
      return this.send("readFile", path, undefined, () => {
        const data = this.fs.get(path);
        if (!data) throw new Error("ErrnoError: FS error");
        return new Uint8Array(data);
      });
    }

    deleteFile(path: string): Promise<boolean> {
      return this.send("deleteFile", path, undefined, () => {
        this.fs.delete(path);
        return true;
      });
    }
  };
}
