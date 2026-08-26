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
        <button class="btn sec" type="button">Browse Demo Files</button>
        <button class="btn sec" type="button">Load from URL</button>
      </div>
    </div>
    <div class="drop-mini">
      <span class="mini-file">
        <span class="fname">clip.mp4</span>
        <span class="fsize">4.2 MB</span>
      </span>
      <button class="btn sm sec icon-only" type="button" title="Reset" aria-label="Reset">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"
          stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polyline points="23 4 23 10 17 10" />
          <path d="M20.49 15 A9 9 0 1 1 18.36 5.64 L23 10" />
        </svg>
      </button>
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
