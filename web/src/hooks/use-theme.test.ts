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
  it("applies the preference remembered by this browser", () => {
    localStorage.setItem("summyz:theme", "light");
    const { result } = renderHook(() => useTheme());
    expect(result.current.preference).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("follows the system when this browser has no preference yet", () => {
    stubMatchMedia(true);
    const { result } = renderHook(() => useTheme());
    expect(result.current.preference).toBe("system");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("stores a preference chosen in this session", () => {
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setPreference("light"));
    expect(localStorage.getItem("summyz:theme")).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("stops listening to the system once unmounted", () => {
    const { removeEventListener } = stubMatchMedia(false);
    const { unmount } = renderHook(() => useTheme());
    unmount();
    expect(removeEventListener).toHaveBeenCalledTimes(1);
  });

  it("does not subscribe once an explicit preference is in place", () => {
    localStorage.setItem("summyz:theme", "dark");
    const { removeEventListener } = stubMatchMedia(false);
    const { unmount } = renderHook(() => useTheme());
    unmount();
    expect(removeEventListener).not.toHaveBeenCalled();
  });

  it("drops the system listener when the operator picks a fixed theme", () => {
    const { removeEventListener } = stubMatchMedia(false);
    const { result } = renderHook(() => useTheme());
    expect(result.current.preference).toBe("system");
    act(() => result.current.setPreference("dark"));
    expect(removeEventListener).toHaveBeenCalledTimes(1);
  });
});
