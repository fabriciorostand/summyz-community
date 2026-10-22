import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { productionSourceDirectories } from "../../scripts/ci/source-directories.js";

it.each([
  ["apps/bot/src", "apps/api/src", "packages/shared/src", "apps/dashboard/src"],
  ["src", "web/src"],
])(
  "measures production source in the checked-out revision's layout: %j",
  async (...directories) => {
    const root = await mkdtemp(join(tmpdir(), "summyz-source-layout-"));
    try {
      for (const directory of directories) await mkdir(join(root, directory), { recursive: true });
      await mkdir(join(root, "media/presentation/src"), { recursive: true });
      expect(await productionSourceDirectories(root)).toEqual(directories);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

it("fails closed when the checked-out revision has no recognized production source", async () => {
  const root = await mkdtemp(join(tmpdir(), "summyz-source-layout-"));
  try {
    await expect(productionSourceDirectories(root)).rejects.toThrow("No production source");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
