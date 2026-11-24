// Waiting on the app's asynchronous work from a test. Imports nothing, so no test file's vi.mock
// reaches it.

/** Lets whatever the last event queued run to completion: one macrotask, by which time an answered
 * fetch has run its .then chain through too. `setTimeout` is looked up on each call, so a test that
 * fakes timers gets the faked one. */
export const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

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
