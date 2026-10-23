import { describe, expect, it } from "vitest";
import { dashboardTaskSchema, meetingHistoryDetailSchema } from "../../src/lib/api-contracts";
import { groupByOwner } from "../../src/lib/task-groups";
import { aMeetingDetail, aTask } from "../test-utils";

describe("groupByOwner", () => {
  it("uses the contextual name when a single assignee has no Discord identity", () => {
    const [group] = groupByOwner(
      [
        aTask({
          ownerNames: ["Fornecedor"],
          ownerName: null,
          ownerDisplayName: null,
          ownerUserId: null,
        }),
      ],
      "Sem responsável",
    );
    expect(group).toMatchObject({ name: "Fornecedor", key: "Fornecedor", openCount: 1 });
  });

  it("preserves all assignees at both API boundaries", () => {
    expect(dashboardTaskSchema.parse(aTask({ ownerNames: ["Bruno", "Carla"] })).ownerNames).toEqual(
      ["Bruno", "Carla"],
    );
    const meeting = aMeetingDetail();
    if (meeting.summary?.status !== "completed") throw new Error("Expected a completed summary");
    const parsed = meetingHistoryDetailSchema.parse({
      ...meeting,
      summary: { ...meeting.summary, tasks: [{ text: "Revisar", ownerNames: ["Bruno", "Carla"] }] },
    });
    expect(parsed.summary).toMatchObject({ tasks: [{ ownerNames: ["Bruno", "Carla"] }] });
  });
  it("keeps shared tasks in a separate group regardless of the assignee order", () => {
    const groups = groupByOwner(
      [
        aTask({
          ownerNames: ["Bruno", "Carla"],
          ownerName: null,
          ownerUserId: null,
          taskId: "shared-1",
        }),
        aTask({
          ownerNames: ["Carla", "Bruno"],
          ownerName: null,
          ownerUserId: null,
          taskId: "shared-2",
        }),
        aTask({
          ownerNames: ["Bruno"],
          ownerName: "Bruno",
          ownerDisplayName: "Bruno",
          ownerUserId: "bruno",
          taskId: "solo",
        }),
      ],
      "Sem responsável",
    );
    expect(groups.map((group) => [group.name, group.tasks.length])).toEqual([
      ["Bruno e Carla", 2],
      ["Bruno", 1],
    ]);
    expect(groups[0]?.avatarUrl).toBeNull();
    expect(groups.flatMap((group) => group.tasks)).toHaveLength(3);
  });

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
