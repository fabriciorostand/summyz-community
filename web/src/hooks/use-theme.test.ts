import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useTheme } from "./use-theme";

function stubMatchMedia(prefersLight: boolean) {
  const listeners: (() => void)[] = [];
  const removeEventListener = vi.fn();
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      addEventListener: (_event: string, listener: () => void) => listeners.push(listener),
      matches: prefersLight,
      removeEventListener,
    })),
  );
  return { listeners, removeEventListener };
}

afterEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  vi.unstubAllGlobals();
});

describe("useTheme", () => {
  it("applies the account preference to the document", () => {
    const { result } = renderHook(() => useTheme("light"));
    expect(result.current.preference).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("falls back to the remembered preference before the account loads", () => {
    localStorage.setItem("summyz:theme", "dark");
    const { result } = renderHook(() => useTheme(undefined));
    expect(result.current.preference).toBe("dark");
  });

  it("stores a preference chosen in this session", () => {
    const { result } = renderHook(() => useTheme("dark"));
    act(() => result.current.setPreference("light"));
    expect(localStorage.getItem("summyz:theme")).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("follows the system while the preference is system", () => {
    stubMatchMedia(true);
    renderHook(() => useTheme("system"));
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("stops listening to the system once unmounted", () => {
    const { removeEventListener } = stubMatchMedia(false);
    const { unmount } = renderHook(() => useTheme("system"));
    unmount();
    expect(removeEventListener).toHaveBeenCalledTimes(1);
  });

  it("does not subscribe once an explicit preference is in place", () => {
    localStorage.setItem("summyz:theme", "dark");
    const { removeEventListener } = stubMatchMedia(false);
    const { unmount } = renderHook(() => useTheme("dark"));
    unmount();
    expect(removeEventListener).not.toHaveBeenCalled();
  });

  it("drops the system listener when the operator picks a fixed theme", () => {
    const { removeEventListener } = stubMatchMedia(false);
    const { result } = renderHook(() => useTheme(undefined));
    expect(result.current.preference).toBe("system");
    act(() => result.current.setPreference("dark"));
    expect(removeEventListener).toHaveBeenCalledTimes(1);
  });
});
