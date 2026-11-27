import { resetIcon } from "@brain-bbqs/ui";
import indexHtml from "../index.html?raw";
import { withCard } from "./utils";

type Mode = "idle" | "dragover" | "loaded";

// The drop zone is taken out of index.html itself rather than written out again here, so the story
// draws the markup the app ships. The rest is what the app adds at run time: the state class, the
// loaded file's name and size, and the reset icon src/ui/fileLoading.ts stamps into its button.
function buildDropzone(mode: Mode): HTMLElement {
  const page = new DOMParser().parseFromString(indexHtml, "text/html");
  const dz = document.importNode(page.querySelector<HTMLElement>("#dropZone")!, true);
  if (mode === "dragover") dz.classList.add("dragover");
  if (mode === "loaded") dz.classList.add("collapsed");
  dz.querySelector("#miniName")!.textContent = "clip.mp4";
  dz.querySelector("#miniSize")!.textContent = "4.2 MB";
  dz.querySelector("#resetBtn")!.append(resetIcon(15));
  return withCard(dz);
}

export default {
  title: "Components/Dropzone",
};

export const Idle = {
  render: () => buildDropzone("idle"),
};

export const DragOver = {
  name: "Drag over",
  render: () => buildDropzone("dragover"),
};

export const FileLoaded = {
  name: "File loaded (collapsed)",
  render: () => buildDropzone("loaded"),
};
