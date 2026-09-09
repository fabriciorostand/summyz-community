import { afterEach, describe, expect, it, vi } from "vitest";

import { applyTheme, readStoredTheme, resolveTheme, storeTheme } from "./theme";

function stubMatchMedia(prefersDark: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      addEventListener: vi.fn(),
      matches: query.includes("dark") ? prefersDark : !prefersDark,
      removeEventListener: vi.fn(),
    })),
  );
}

afterEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

describe("resolveTheme", () => {
  it("keeps an explicit dark preference", () => {
    expect(resolveTheme("dark")).toBe("dark");
  });

  it("keeps an explicit light preference", () => {
    expect(resolveTheme("light")).toBe("light");
  });

  it("follows the system when it prefers dark", () => {
    stubMatchMedia(true);
    expect(resolveTheme("system")).toBe("dark");
  });

  it("follows the system when it prefers light", () => {
    stubMatchMedia(false);
    expect(resolveTheme("system")).toBe("light");
  });

  it("falls back to dark when the browser cannot answer", () => {
    vi.stubGlobal("matchMedia", undefined);
    expect(resolveTheme("system")).toBe("dark");
  });
});

describe("applyTheme", () => {
  it("stamps the resolved theme on the document root", () => {
    applyTheme("light");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("resolves system before stamping", () => {
    stubMatchMedia(true);
    applyTheme("system");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});

describe("stored preference", () => {
  it("round-trips a preference through storage", () => {
    storeTheme("light");
    expect(readStoredTheme()).toBe("light");
  });

  it("returns undefined when nothing was stored", () => {
    expect(readStoredTheme()).toBeUndefined();
  });

  it("ignores a stored value outside the allowed set", () => {
    localStorage.setItem("summyz:theme", "neon");
    expect(readStoredTheme()).toBeUndefined();
  });

  it("survives storage being unavailable", () => {
    const failing = vi.fn(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(failing);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(failing);
    expect(readStoredTheme()).toBeUndefined();
    expect(() => storeTheme("dark")).not.toThrow();
  });
});
