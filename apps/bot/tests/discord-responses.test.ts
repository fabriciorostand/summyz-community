import { MessageFlags } from "discord.js";
import { describe, expect, it } from "vitest";

import { createEphemeralReply } from "../src/discord/responses.js";

describe("respostas do Discord", () => {
  it("usa a flag atual para respostas efêmeras", () => {
    expect(createEphemeralReply("Mensagem")).toEqual({
      content: "Mensagem",
      flags: MessageFlags.Ephemeral,
    });
  });
});
