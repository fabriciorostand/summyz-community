import { describe, expect, it } from "vitest";

import { createCommandReference } from "../src/discord/command-catalog.js";
import { createCommandDefinitions } from "../src/discord/commands.js";

describe("comandos do bot", () => {
  const commandDefinitions = createCommandDefinitions("pt-BR");

  it("expõe os comandos de gravação e configuração", () => {
    expect(commandDefinitions.map((command) => command.toJSON().name)).toEqual([
      "record",
      "stop",
      "recording-role",
      "recording-summary-forum",
      "recording-cost",
    ]);
  });

  it("expõe consulta administrativa por reunião e período", () => {
    const command = commandDefinitions.find(
      (definition) => definition.toJSON().name === "recording-cost",
    );
    const definition = command?.toJSON();

    expect(definition?.default_member_permissions).toBe(String(8n));
    expect(definition?.options?.map((option) => option.name)).toEqual(["meeting", "period"]);
    expect(definition?.options?.[0]).toMatchObject({
      name: "meeting",
      options: [expect.objectContaining({ name: "id", required: true })],
    });
    expect(definition?.options?.[1]).toMatchObject({
      name: "period",
      options: [
        expect.objectContaining({ name: "from", required: true }),
        expect.objectContaining({ name: "to", required: true }),
      ],
    });
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

  it("traduz todas as descrições para o idioma configurado", () => {
    const english = createCommandDefinitions("en").map((command) => command.toJSON());
    const portuguese = createCommandDefinitions("pt-BR").map((command) => command.toJSON());

    expect(JSON.stringify(english)).toContain("Starts recording the voice channel you are in");
    expect(JSON.stringify(english)).toContain("Forum that will receive the posts");
    expect(JSON.stringify(english)).not.toContain("gravação");
    expect(JSON.stringify(portuguese)).toContain(
      "Inicia a gravação do canal de voz em que você está",
    );
  });

  it("mantém a referência do dashboard alinhada aos comandos registrados", () => {
    const registeredPaths = commandDefinitions.flatMap((command) => {
      const definition = command.toJSON();
      const subcommands = definition.options?.filter((option) => option.type === 1) ?? [];
      return subcommands.length === 0
        ? [`/${definition.name}`]
        : subcommands.map((subcommand) => `/${definition.name} ${subcommand.name}`);
    });
    const referencePaths = createCommandReference("pt-BR").flatMap((group) =>
      group.commands.map((command) => command.name),
    );

    expect(referencePaths.toSorted()).toEqual(registeredPaths.toSorted());
  });

  it("localiza os grupos e as descrições da referência", () => {
    const english = createCommandReference("en");
    const portuguese = createCommandReference("pt-BR");

    expect(english[0]).toMatchObject({
      commands: [
        {
          description: "Starts recording the voice channel you are in",
          name: "/record",
        },
        {
          description: "Stops recording the voice channel you are in",
          name: "/stop",
        },
      ],
      label: "Recording",
    });
    expect(portuguese[0]).toMatchObject({
      commands: [
        {
          description: "Inicia a gravação do canal de voz em que você está",
          name: "/record",
        },
        {
          description: "Encerra a gravação do canal de voz em que você está",
          name: "/stop",
        },
      ],
      label: "Gravação",
    });
  });
});
