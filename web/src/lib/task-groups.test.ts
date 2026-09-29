import { describe, expect, it } from "vitest";

import { aTask } from "../tests/test-utils";
import { groupByOwner } from "./task-groups";

describe("groupByOwner", () => {
  it("groups by Discord user, falling back to the extracted name", () => {
    const groups = groupByOwner(
      [
        aTask({ ownerDisplayName: "PixelPaladin", ownerUserId: "u1", taskId: "1" }),
        aTask({ ownerDisplayName: "PixelPaladin", ownerUserId: "u1", taskId: "2" }),
        aTask({ ownerDisplayName: null, ownerName: "Rita", ownerUserId: null, taskId: "3" }),
        aTask({ ownerDisplayName: null, ownerName: null, ownerUserId: null, taskId: "4" }),
      ],
      "Sem responsável",
    );
    expect(groups.map((group) => [group.name, group.tasks.length])).toEqual([
      ["PixelPaladin", 2],
      ["Rita", 1],
      ["Sem responsável", 1],
    ]);
  });

  it("counts only open tasks and overdue ones", () => {
    const [group] = groupByOwner(
      [
        aTask({ overdue: true, taskId: "1" }),
        aTask({ completedAt: "2026-09-01T00:00:00.000Z", overdue: true, taskId: "2" }),
        aTask({ taskId: "3" }),
      ],
      "Sem responsável",
    );
    expect(group).toMatchObject({ openCount: 2, overdueCount: 1 });
  });

  it("orders the busiest owner first", () => {
    const groups = groupByOwner(
      [
        aTask({ ownerUserId: "u2", taskId: "1" }),
        aTask({ ownerUserId: "u1", taskId: "2" }),
        aTask({ ownerUserId: "u1", taskId: "3" }),
      ],
      "No owner",
    );
    expect(groups.map((group) => group.key)).toEqual(["u1", "u2"]);
  });
});
