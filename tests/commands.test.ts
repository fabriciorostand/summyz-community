import { describe, expect, it } from "vitest";

import { commandDefinitions } from "../src/discord/commands.js";

describe("comandos do bot", () => {
  it("expõe os comandos de gravação e configuração", () => {
    expect(commandDefinitions.map((command) => command.toJSON().name)).toEqual([
      "record",
      "stop",
      "recording-role",
      "recording-summary-forum",
    ]);
  });

  it("permite adicionar, remover e listar cargos de gravação", () => {
    const command = commandDefinitions.find(
      (definition) => definition.toJSON().name === "recording-role",
    );

    expect(command?.toJSON().options?.map((option) => option.name)).toEqual([
      "add",
      "remove",
      "list",
    ]);
  });

  it("permite configurar, consultar e limpar o fórum de resumos", () => {
    const command = commandDefinitions.find(
      (definition) => definition.toJSON().name === "recording-summary-forum",
    );
    const definition = command?.toJSON();

    expect(definition?.default_member_permissions).toBeUndefined();
    expect(definition?.options?.map((option) => option.name)).toEqual(["set", "show", "clear"]);
    expect(definition?.options?.[0]).toMatchObject({
      name: "set",
      options: [
        expect.objectContaining({ channel_types: [15], name: "forum", required: true }),
        expect.objectContaining({ name: "tag", required: false }),
      ],
    });
  });
});
