import { describe, expect, it } from "vitest";

import { mapWithConcurrency } from "../src/transcription/concurrency.js";

describe("concorrência da transcrição", () => {
  it("rejeita limites inválidos", async () => {
    await expect(mapWithConcurrency([1], 0, async (value) => value)).rejects.toThrow(
      /concorrência/i,
    );
  });

  it("não excede o número configurado de operações simultâneas", async () => {
    let active = 0;
    let maximumActive = 0;
    const releases: Array<() => void> = [];

    const operation = mapWithConcurrency([1, 2, 3, 4], 2, async (value) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise<void>((resolve) => releases.push(resolve));
      active -= 1;
      return value * 2;
    });

    await viWaitUntil(() => releases.length === 2);
    releases.shift()?.();
    releases.shift()?.();
    await viWaitUntil(() => releases.length === 2);
    releases.shift()?.();
    releases.shift()?.();

    await expect(operation).resolves.toEqual([2, 4, 6, 8]);
    expect(maximumActive).toBe(2);
  });

  it("aguarda operações em voo antes de propagar uma falha", async () => {
    let release: (() => void) | undefined;
    const operation = mapWithConcurrency([1, 2], 2, async (value) => {
      if (value === 1) {
        throw new Error("falha");
      }
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return value;
    });
    let settled = false;
    void operation.catch(() => {
      settled = true;
    });
    await viWaitUntil(() => release !== undefined);
    await new Promise((resolve) => setImmediate(resolve));
    expect(settled).toBe(false);

    release?.();
    await expect(operation).rejects.toThrow("falha");
  });
});

async function viWaitUntil(condition: () => boolean): Promise<void> {
  for (let index = 0; index < 20 && !condition(); index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  expect(condition()).toBe(true);
}
