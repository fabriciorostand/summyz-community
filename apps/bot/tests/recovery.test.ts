import { describe, expect, it } from "vitest";

import { decideRecovery } from "../src/recording/recovery.js";

describe("recuperação de gravações", () => {
  it("retoma uma gravação interrompida quando ainda há pessoas no canal", () => {
    expect(decideRecovery({ humanCount: 2, manifestStatus: "interrupted" })).toBe("resume");
  });

  it("finaliza como interrompida quando o canal está vazio", () => {
    expect(decideRecovery({ humanCount: 0, manifestStatus: "interrupted" })).toBe(
      "finalize_interrupted",
    );
  });

  it("ignora reuniões já concluídas", () => {
    expect(decideRecovery({ humanCount: 2, manifestStatus: "completed" })).toBe("ignore");
  });
});
