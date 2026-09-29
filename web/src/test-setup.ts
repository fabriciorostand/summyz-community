import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

import { reloadPreferences } from "./i18n/store";

// The suite reads the dashboard in Brazilian Portuguese unless a test says otherwise; tests that
// cover English or detection override the browser languages or store a manual choice.
Object.defineProperty(window.navigator, "languages", {
  configurable: true,
  get: () => ["pt-BR"],
});

// jsdom implements <dialog> without the modal API; mirror the open state and the close event.
if (typeof HTMLDialogElement.prototype.showModal !== "function") {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.open = false;
    this.dispatchEvent(new Event("close"));
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  reloadPreferences();
});
