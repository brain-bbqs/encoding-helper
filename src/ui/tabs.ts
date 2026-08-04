// Tab switching.

export function initTabs(onShowReport: () => void): void {
  document.querySelectorAll<HTMLButtonElement>(".tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll<HTMLButtonElement>(".tab").forEach((b) => b.classList.toggle("on", b === btn));
      document.querySelectorAll<HTMLElement>(".tab-panel").forEach((p) => p.classList.remove("on"));
      const panel = document.getElementById("panel-" + btn.dataset.tab);
      panel?.classList.add("on");
      // Rebuilt on every visit (not just at load) since it reflects whatever the seeking test /
      // Encode Test tabs have produced since the file was loaded.
      if (btn.dataset.tab === "report") onShowReport();
    });
  });
}
