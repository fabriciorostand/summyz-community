import { stat } from "node:fs/promises";
import { expect, it } from "vitest";
import { productionSourceDirectories } from "../../scripts/ci/source-directories.js";

it("measures the production source of every workspace", async () => {
  expect(productionSourceDirectories).toEqual([
    "apps/bot/src",
    "apps/api/src",
    "packages/shared/src",
    "apps/dashboard/src",
  ]);
  for (const directory of productionSourceDirectories) {
    expect((await stat(new URL(`../../${directory}/`, import.meta.url))).isDirectory()).toBe(true);
  }
});
