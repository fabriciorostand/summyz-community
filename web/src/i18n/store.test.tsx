import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getI18n,
  reloadPreferences,
  setDateFormat,
  setLanguage,
  setTimeFormat,
  startI18n,
  useI18n,
} from "./store";

function stubBrowserLanguages(languages: string[]) {
  vi.spyOn(navigator, "languages", "get").mockReturnValue(languages);
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  reloadPreferences();
});

describe("i18n store", () => {
  it("follows the first supported browser language when nothing was chosen", () => {
    stubBrowserLanguages(["es-ES", "en-GB"]);
    reloadPreferences();

    expect(getI18n().language).toBe("en");
    expect(getI18n().t.nav.overview).toBe("Overview");
  });

  it("lets a manual choice win over the browser and remembers it", () => {
    stubBrowserLanguages(["en-US"]);
    setLanguage("pt-BR");

    expect(getI18n().language).toBe("pt-BR");
    expect(localStorage.getItem("summyz:language")).toBe("pt-BR");
    reloadPreferences();
    expect(getI18n().language).toBe("pt-BR");
  });

  it("resolves automatic formats from the region of the browser's first language", () => {
    stubBrowserLanguages(["es-ES", "en-US"]);
    reloadPreferences();

    expect(getI18n()).toMatchObject({
      dateFormat: "DD/MM/YYYY",
      dateFormatPreference: "auto",
      language: "en",
      timeFormat: "24h",
      timeFormatPreference: "auto",
    });
  });

  it("uses explicit formats once they are chosen, independently of the language", () => {
    stubBrowserLanguages(["pt-BR"]);
    setDateFormat("YYYY-MM-DD");
    setTimeFormat("12h");

    expect(getI18n()).toMatchObject({
      dateFormat: "YYYY-MM-DD",
      language: "pt-BR",
      timeFormat: "12h",
    });
    expect(getI18n().format.dayMonth("2026-09-04")).toBe("09-04");
  });

  it("goes back to the browser region when automatic is chosen again", () => {
    stubBrowserLanguages(["en-US"]);
    setDateFormat("DD/MM/YYYY");
    setDateFormat("auto");

    expect(getI18n().dateFormat).toBe("MM/DD/YYYY");
  });

  it("re-renders subscribed components and keeps the document language in sync", () => {
    stubBrowserLanguages(["pt-BR"]);
    reloadPreferences();
    const stop = startI18n();
    function Title() {
      return <h1>{useI18n().t.nav.overview}</h1>;
    }
    render(<Title />);
    expect(screen.getByRole("heading")).toHaveTextContent("Visão geral");
    expect(document.documentElement.lang).toBe("pt-BR");

    act(() => setLanguage("en"));

    expect(screen.getByRole("heading")).toHaveTextContent("Overview");
    expect(document.documentElement.lang).toBe("en");
    stop();
  });

  it("picks up a choice made in another tab", () => {
    stubBrowserLanguages(["pt-BR"]);
    reloadPreferences();
    const stop = startI18n();

    localStorage.setItem("summyz:language", "en");
    window.dispatchEvent(new StorageEvent("storage", { key: "summyz:language" }));

    expect(getI18n().language).toBe("en");
    stop();
  });

  it("ignores storage changes that are not presentation preferences", () => {
    stubBrowserLanguages(["pt-BR"]);
    reloadPreferences();
    const stop = startI18n();
    const before = getI18n();

    window.dispatchEvent(new StorageEvent("storage", { key: "summyz:selected-guild" }));

    expect(getI18n()).toBe(before);
    stop();
  });
});
