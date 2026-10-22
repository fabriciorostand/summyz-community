import { describe, expect, it } from "vitest";
import {
  formatTaskDeadline,
  formatTaskOwners,
  taskOwners,
} from "../src/summary/task-presentation.js";

describe("apresentação das tarefas", () => {
  it("preserva nomes antigos e permite tarefas sem responsáveis", () => {
    expect(taskOwners({ ownerName: "Ana" })).toEqual(["Ana"]);
    expect(taskOwners({})).toEqual([]);
    expect(taskOwners({ ownerName: "Ana", ownerNames: [] })).toEqual([]);
    expect(formatTaskOwners({ ownerNames: ["Bruno", "Carla"] }, "en")).toBe("Bruno and Carla");
  });
  it("não inventa data ou prazo e não repete a data já escrita", () => {
    expect(formatTaskDeadline({ ownerNames: [], deadlineDate: "2026-10-22" })).toBeUndefined();
    expect(formatTaskDeadline({ ownerNames: [], deadlineText: "quando possível" })).toBe(
      "quando possível",
    );
    expect(
      formatTaskDeadline({
        ownerNames: [],
        deadlineText: "quinta (22/10)",
        deadlineDate: "2026-10-22",
      }),
    ).toBe("quinta (22/10)");
    expect(
      formatTaskDeadline({ ownerNames: [], deadlineText: "amanhã", deadlineDate: "2027-01-01" }),
    ).toBe("amanhã (01/01)");
  });
});
