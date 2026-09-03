// Container knowledge base — maps mediabunny's input format name (what `Input.getFormat().name`
// returns) to the record describing that container. The records are prose, so they live with the
// rest of the app's copy in lib/explainers; what is left here is the lookup.

import { CONTAINER_KB } from "./explainers";
import type { ContainerInfo } from "./types";

export function describeContainer(formatName: string | null | undefined): ContainerInfo | null {
  if (!formatName) return null;
  return CONTAINER_KB[formatName] ?? null;
}
