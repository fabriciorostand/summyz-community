import { describe, expect, it } from "vitest";

import { getInteractionText } from "../src/discord/interaction-text.js";

describe("textos das interações do Discord", () => {
  it.each([
    [
      "pt-BR",
      "Gravação iniciada em **Lobby** por <@user-1>. O áudio dos participantes será gravado. ID: `meeting-1`",
    ],
    [
      "en",
      "Recording started in **Lobby** by <@user-1>. Participant audio will be recorded. ID: `meeting-1`",
    ],
  ] as const)("announces recording without an emoji in %s", (language, expected) => {
    expect(getInteractionText(language).recordingStarted("Lobby", "<@user-1>", "meeting-1")).toBe(
      expected,
    );
  });

  it("fornece todas as mensagens dinâmicas em inglês", () => {
    const text = getInteractionText("en");
    const messages = [
      ...Object.values(text).filter((value): value is string => typeof value === "string"),
      text.authorizedRoles(["role-1"]),
      text.forumConfigured("forum-1"),
      text.forumConfigured("forum-1", "Meeting"),
      text.forumDisplay("forum-1"),
      text.forumDisplay("forum-1", "tag-1"),
      text.recordingStarted("Lobby", "<@user-1>", "meeting-1"),
      text.roleAuthorized("<@&role-1>"),
      text.roleRemoved("<@&role-1>"),
      text.stopProcessed("text-1"),
    ];

    expect(messages).toContain("This command can only be used in a server.");
    expect(messages.join(" ")).toContain("Summary forum configured");
    expect(messages.join(" ")).toContain("Recording started");
    expect(messages.join(" ")).not.toMatch(
      /você|gravação|fórum|resumo|configuração|cargo|nenhum|não/i,
    );
  });

  it("mantém as mensagens em português quando pt-BR é selecionado", () => {
    const text = getInteractionText("pt-BR");

    expect(text.guildOnly).toBe("Este comando só pode ser usado em um servidor.");
    expect(text.forumConfigured("forum-1", "Reunião")).toContain("com a tag **Reunião**");
  });
});
