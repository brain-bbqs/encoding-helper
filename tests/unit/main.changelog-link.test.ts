// @vitest-environment jsdom
// A shared link to /#changelog opens What's New as the page boots.
import { beforeAll, expect, it, vi } from "vitest";
import { bootMain, el } from "./helpers/mainHarness";

beforeAll(async () => {
  await bootMain("#changelog");
});

it("opens the modal at boot, and drops the fragment once it is closed", async () => {
  const modal = el<HTMLDialogElement>("whats-new-modal");
  expect(modal.open).toBe(true);
  expect(el("whats-new-content").querySelectorAll(".changelog-version").length).toBe(3);

  el("whats-new-close").click();
  expect(modal.open).toBe(false);
  await vi.waitFor(() => expect(window.location.hash).toBe(""));
});
