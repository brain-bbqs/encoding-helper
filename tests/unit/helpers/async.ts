// Waiting on the app's asynchronous work from a test. Imports nothing but vitest itself, so no test
// file's vi.mock reaches it.

import { expect, vi } from "vitest";

/** Lets whatever the last event queued run to completion: one macrotask, by which time an answered
 * fetch has run its .then chain through too. `setTimeout` is looked up on each call, so a test that
 * fakes timers gets the faked one. */
export const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** Waits, polling every 2ms for up to 3s, until `pred` holds: for work that takes an unknown number of
 * macrotasks, such as a fake ffmpeg core answering a chain of calls. */
export async function until(pred: () => boolean): Promise<void> {
  await vi.waitFor(() => expect(pred()).toBe(true), { interval: 2, timeout: 3000 });
}

/** Waits out five macrotasks, enough for every reply a fake ffmpeg core still has on its way, so
 * nothing of one case lands in the next. */
export async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await flush();
}

/** A promise settled from outside, standing in for work still in flight. */
export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (err: Error) => void;
}

export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (err: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
