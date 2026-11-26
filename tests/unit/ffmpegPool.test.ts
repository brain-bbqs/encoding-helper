import { describe, expect, it, vi } from "vitest";
import { drainWithPool, ffmpegPool, MAX_POOL_WORKERS, poolSizeFor } from "../../src/lib/ffmpegPool";
import { defaultFfmpegWorker, type FfmpegWorker } from "../../src/lib/ffmpegEngine";
import { deferred, flush } from "./helpers/async";

vi.mock("@ffmpeg/util", () => ({ toBlobURL: () => Promise.resolve("blob:core") }));
vi.mock("@ffmpeg/ffmpeg", () => ({ FFmpeg: class {} }));

/** A core that does nothing but say which one it is. */
function fakeWorker(id: number): FfmpegWorker {
  return { id } as FfmpegWorker;
}

describe("poolSizeFor", () => {
  it("leaves a CPU to the page", () => {
    expect(poolSizeFor(100, 4)).toBe(3);
  });

  it("never runs more cores than there is work", () => {
    expect(poolSizeFor(2, 16)).toBe(2);
  });

  it("caps the pool however many CPUs are on offer", () => {
    expect(poolSizeFor(100, 64)).toBe(MAX_POOL_WORKERS);
  });

  it("still runs on a single-core machine, or one that will not say", () => {
    expect(poolSizeFor(10, 1)).toBe(1);
    expect(poolSizeFor(10, NaN)).toBe(1);
  });
});

describe("ffmpegPool", () => {
  it("starts with the app's own core and numbers the rest after it", () => {
    const pool = ffmpegPool(3);
    expect(pool[0]).toBe(defaultFfmpegWorker);
    expect(pool.map((w) => w.id)).toEqual([0, 1, 2]);
  });

  // Loading a core is not free, and each keeps the stretches it was already handed, so the next
  // run gets the same cores back rather than fresh ones.
  it("hands the same extra cores back to a later run", () => {
    const first = ffmpegPool(3);
    const again = ffmpegPool(2);
    expect(again).toHaveLength(2);
    expect(again[1]).toBe(first[1]);
    expect(ffmpegPool(3)[2]).toBe(first[2]);
  });

  it("is never fewer than the default core", () => {
    expect(ffmpegPool(0)).toEqual([defaultFfmpegWorker]);
  });
});

describe("drainWithPool", () => {
  it("gives every item to exactly one core", async () => {
    const items = [1, 2, 3, 4, 5, 6, 7];
    const seen: number[] = [];
    await drainWithPool(items, [fakeWorker(0), fakeWorker(1)], async (item) => {
      await Promise.resolve();
      seen.push(item);
    });
    expect(seen.sort((a, b) => a - b)).toEqual(items);
  });

  it("keeps every core busy rather than taking turns", async () => {
    let running = 0;
    let mostAtOnce = 0;
    await drainWithPool([1, 2, 3, 4, 5, 6], [fakeWorker(0), fakeWorker(1), fakeWorker(2)], async () => {
      running++;
      mostAtOnce = Math.max(mostAtOnce, running);
      await Promise.resolve();
      running--;
    });
    expect(mostAtOnce).toBe(3);
  });

  // A square retried while the sweep is still going is appended to the queue it is working through.
  it("picks up items appended while it runs", async () => {
    const queue = [1, 2];
    const seen: number[] = [];
    await drainWithPool(queue, [fakeWorker(0)], async (item) => {
      seen.push(item);
      if (item === 1) queue.push(99);
    });
    expect(seen).toEqual([1, 2, 99]);
  });

  it("picks up an item appended while the last one is still being worked on", async () => {
    const queue = [1];
    const seen: number[] = [];
    let added = false;
    await drainWithPool(queue, [fakeWorker(0)], async (item) => {
      seen.push(item);
      if (!added) {
        added = true;
        // Appended after an await, while the only core is still inside this item; its own loop
        // then takes the new one.
        await Promise.resolve();
        queue.push(2);
      }
    });
    expect(seen).toEqual([1, 2]);
  });

  // On a machine with cores to spare, a square retried late in a sweep arrives after one core has
  // found the queue empty and left; the core still working takes it.
  it("runs an item appended after one of its cores has run out of work", async () => {
    const queue = [1, 2];
    const seen: number[] = [];
    const held = deferred<void>();
    const drain = drainWithPool(queue, [fakeWorker(0), fakeWorker(1)], async (item) => {
      seen.push(item);
      if (item === 1) await held.promise;
    });
    // Item 2 is done and its core has found nothing left to take, while item 1 is still running.
    await flush();
    expect(seen).toEqual([1, 2]);

    queue.push(3);
    held.resolve();
    await drain;

    expect(seen).toEqual([1, 2, 3]);
  });

  // `work` is meant to record its own failures; one that throws anyway does not leave a core busy
  // behind a run that has already reported back, nor one still being handed items.
  it("hands out nothing more once an item throws, and rethrows the first error after the rest finish", async () => {
    const seen: number[] = [];
    const first = new Error("item 1 failed");
    const held = deferred<void>();
    let settled = false;
    const outcome = drainWithPool([1, 2, 3, 4], [fakeWorker(0), fakeWorker(1)], async (item) => {
      seen.push(item);
      if (item === 1) throw first;
      await held.promise;
    }).then(
      () => null,
      (err: unknown) => err,
    );
    void outcome.finally(() => {
      settled = true;
    });
    await flush();
    expect(settled).toBe(false);

    held.reject(new Error("item 2 failed"));

    expect(await outcome).toBe(first);
    expect(seen).toEqual([1, 2]);
  });

  it("stops handing out work once the run is cancelled", async () => {
    const seen: number[] = [];
    let stop = false;
    await drainWithPool(
      [1, 2, 3, 4, 5, 6],
      [fakeWorker(0)],
      async (item) => {
        seen.push(item);
        if (item === 2) stop = true;
        await Promise.resolve();
      },
      () => stop,
    );
    expect(seen).toEqual([1, 2]);
  });

  it("works through every item in order on a single core", async () => {
    const seen: number[] = [];
    await drainWithPool([1, 2, 3], [fakeWorker(0)], async (item) => {
      seen.push(item);
      await Promise.resolve();
    });
    expect(seen).toEqual([1, 2, 3]);
  });
});
