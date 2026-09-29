import { afterEach, describe, expect, it, vi } from "vitest";

import {
  browserTimeZone,
  detectLanguage,
  isAcceptedTimeZone,
  readStoredDateFormat,
  readStoredLanguage,
  readStoredTimeFormat,
  resolveDateFormat,
  resolveTimeFormat,
  storeDateFormat,
  storeLanguage,
  storeTimeFormat,
} from "./preferences";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("detectLanguage", () => {
  it("uses Brazilian Portuguese when the browser asks for it first", () => {
    expect(detectLanguage(["pt-BR", "en-US"])).toBe("pt-BR");
  });

  it("matches language tags regardless of case", () => {
    expect(detectLanguage(["PT-br"])).toBe("pt-BR");
  });

  it("uses English for any English variant", () => {
    expect(detectLanguage(["en-GB"])).toBe("en");
    expect(detectLanguage(["en"])).toBe("en");
  });

  it("skips unsupported languages and keeps looking down the list", () => {
    expect(detectLanguage(["es-ES", "fr", "pt-BR"])).toBe("pt-BR");
  });

  it("does not treat European or unqualified Portuguese as Brazilian Portuguese", () => {
    expect(detectLanguage(["pt-PT"])).toBe("en");
    expect(detectLanguage(["pt"])).toBe("en");
    expect(detectLanguage(["pt", "pt-BR"])).toBe("pt-BR");
  });

  it("falls back to English when nothing in the list is supported", () => {
    expect(detectLanguage(["es-ES", "de"])).toBe("en");
    expect(detectLanguage([])).toBe("en");
  });
});

describe("resolveDateFormat", () => {
  it("follows the day-month order of the browser region", () => {
    expect(resolveDateFormat("pt-BR")).toBe("DD/MM/YYYY");
    expect(resolveDateFormat("es-ES")).toBe("DD/MM/YYYY");
    expect(resolveDateFormat("en-GB")).toBe("DD/MM/YYYY");
  });

  it("follows the month-day order of the browser region", () => {
    expect(resolveDateFormat("en-US")).toBe("MM/DD/YYYY");
    expect(resolveDateFormat("en")).toBe("MM/DD/YYYY");
  });

  it("maps year-first regions to the ISO order", () => {
    expect(resolveDateFormat("sv-SE")).toBe("YYYY-MM-DD");
    expect(resolveDateFormat("ja-JP")).toBe("YYYY-MM-DD");
  });

  it("falls back to the day-month order for a tag Intl rejects", () => {
    expect(resolveDateFormat("not a tag")).toBe("DD/MM/YYYY");
  });
});

describe("resolveTimeFormat", () => {
  it("uses the 24-hour clock where the region does", () => {
    expect(resolveTimeFormat("pt-BR")).toBe("24h");
    expect(resolveTimeFormat("en-GB")).toBe("24h");
  });

  it("uses the 12-hour clock where the region does", () => {
    expect(resolveTimeFormat("en-US")).toBe("12h");
  });

  it("falls back to the 24-hour clock for a tag Intl rejects", () => {
    expect(resolveTimeFormat("not a tag")).toBe("24h");
  });
});

describe("time zones", () => {
  it("accepts UTC and regional IANA identifiers, as the API does", () => {
    expect(isAcceptedTimeZone("UTC")).toBe(true);
    expect(isAcceptedTimeZone("America/Sao_Paulo")).toBe(true);
    expect(isAcceptedTimeZone("America/Argentina/Buenos_Aires")).toBe(true);
  });

  it("rejects offsets, abbreviations and unknown zones", () => {
    expect(isAcceptedTimeZone("-03:00")).toBe(false);
    expect(isAcceptedTimeZone("EST")).toBe(false);
    expect(isAcceptedTimeZone("Mars/Olympus_Mons")).toBe(false);
  });

  it("reads the browser time zone", () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({
      ...new Intl.DateTimeFormat("en-US").resolvedOptions(),
      timeZone: "Europe/Lisbon",
    });
    expect(browserTimeZone()).toBe("Europe/Lisbon");
  });

  it("falls back to UTC when the browser reports a zone the API would refuse", () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({
      ...new Intl.DateTimeFormat("en-US").resolvedOptions(),
      timeZone: "EST5EDT",
    });
    expect(browserTimeZone()).toBe("UTC");
  });
});

describe("stored preferences", () => {
  it("round-trips the manual choices through this browser", () => {
    storeLanguage("en");
    storeDateFormat("YYYY-MM-DD");
    storeTimeFormat("12h");

    expect(readStoredLanguage()).toBe("en");
    expect(readStoredDateFormat()).toBe("YYYY-MM-DD");
    expect(readStoredTimeFormat()).toBe("12h");
  });

  it("treats missing or tampered values as no choice", () => {
    expect(readStoredLanguage()).toBeUndefined();
    localStorage.setItem("summyz:language", "fr");
    localStorage.setItem("summyz:date-format", "DD.MM.YYYY");
    localStorage.setItem("summyz:time-format", "36h");

    expect(readStoredLanguage()).toBeUndefined();
    expect(readStoredDateFormat()).toBe("auto");
    expect(readStoredTimeFormat()).toBe("auto");
  });

  it("keeps working when the browser blocks site storage", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });

    expect(() => storeLanguage("en")).not.toThrow();
    expect(readStoredLanguage()).toBeUndefined();
    expect(readStoredDateFormat()).toBe("auto");
  });
});
