import { describe, expect, it } from "vitest";

import { en } from "./en";
import { ptBR } from "./pt-BR";

type Entry = [path: string, value: unknown];

function entries(node: unknown, path = ""): Entry[] {
  if (typeof node !== "object" || node === null) return [[path, node]];
  return Object.entries(node).flatMap(([key, value]) =>
    entries(value, path === "" ? key : `${path}.${key}`),
  );
}

/** Renders every message, calling templates once with singular and once with plural inputs. */
function rendered(dictionary: object): Entry[] {
  return entries(dictionary).flatMap(([path, value]): Entry[] =>
    typeof value === "function"
      ? [
          [`${path}(1)`, value(1, 1, 1)],
          [`${path}(2)`, value(2, 2, 2)],
          [`${path}(false)`, value(false, false, false)],
        ]
      : [[path, value]],
  );
}

describe.each([
  ["pt-BR", ptBR],
  ["en", en],
])("%s dictionary", (_language, dictionary) => {
  it("renders every message as non-empty text", () => {
    for (const [path, text] of rendered(dictionary)) {
      expect(typeof text, path).toBe("string");
      expect(String(text).trim(), path).not.toBe("");
      expect(String(text), path).not.toContain("undefined");
    }
  });
});

describe("dictionaries", () => {
  it("describe the same screens with the same keys", () => {
    const keys = (dictionary: object) =>
      entries(dictionary)
        .map(([path]) => path)
        .filter((path) => !path.startsWith("commands.descriptions."))
        .sort();
    expect(keys(en)).toEqual(keys(ptBR));
  });

  it("leave no Portuguese behind in English", () => {
    for (const [path, text] of rendered(en)) {
      expect(String(text), path).not.toMatch(/[ãõçáéíóúâêô]/u);
    }
  });

  it("use singular and plural where counts show up", () => {
    expect(ptBR.tasks.open(1)).toBe("1 aberta");
    expect(ptBR.tasks.open(3)).toBe("3 abertas");
    expect(ptBR.costs.unresolvedCount(1)).toBe("1 pendente");
    expect(ptBR.costs.unresolvedCount(2)).toBe("2 pendentes");
    expect(en.overview.failedCount(1)).toBe("1 failure");
    expect(en.saveBar.missingDetail("a", 2, 1)).toBe(
      "Since a are not installed yet, that server will not be able to record until the download finishes.",
    );
  });
});
