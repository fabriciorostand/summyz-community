import { describe, expect, it } from "vitest";

import { commandDefinitions } from "../src/discord/commands.js";

describe("comandos do bot", () => {
  it("expõe record, stop e recording-role", () => {
    expect(commandDefinitions.map((command) => command.toJSON().name)).toEqual([
      "record",
      "stop",
      "recording-role",
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
});
