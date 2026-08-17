import { withCard } from "./utils";

type Mode = "idle" | "dragover" | "loaded";

function buildDropzone(mode: Mode): HTMLElement {
  const dz = document.createElement("div");
  dz.className = "drop-zone";
  if (mode === "dragover") dz.classList.add("dragover");
  if (mode === "loaded") dz.classList.add("collapsed");
  dz.innerHTML = `
    <div class="drop-full">
      <div><strong>Drop a video file here</strong>, or choose an option below</div>
      <div class="load-actions">
        <button class="btn" type="button">Choose File</button>
        <button class="btn sec" type="button">Load Sample</button>
        <button class="btn sec" type="button">Load from URL</button>
      </div>
    </div>
    <div class="drop-mini">
      <span class="mini-file">
        <span class="fname">clip.mp4</span>
        <span class="fsize">4.2 MB</span>
      </span>
      <button class="btn sm sec" type="button">Reset</button>
    </div>
  `;
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
