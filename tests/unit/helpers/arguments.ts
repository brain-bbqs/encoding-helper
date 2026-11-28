// Standing in for the engine's cap on how many arguments one call can take. Imports vitest alone,
// so no test file's vi.mock reaches it.

import { vi } from "vitest";

/**
 * Makes Math.min and Math.max throw, as V8 does past about 125,000 arguments, once a call passes
 * them more than `limit`: a list spread into one of them then fails at a length a test can afford
 * to build. Returns what puts the two back; vi.restoreAllMocks does the same.
 */
export function capArguments(limit: number): () => void {
  const spies = (["min", "max"] as const).map((name) => {
    const original = Math[name];
    return vi.spyOn(Math, name).mockImplementation((...values: number[]) => {
      if (values.length > limit) throw new RangeError("Maximum call stack size exceeded");
      return original(...values);
    });
  });
  return () => spies.forEach((spy) => spy.mockRestore());
}
