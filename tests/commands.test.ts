import { describe, expect, it } from "vitest";

import { createCommandReference } from "../src/discord/command-catalog.js";
import { createCommandDefinitions } from "../src/discord/commands.js";

describe("comandos do bot", () => {
  const commandDefinitions = createCommandDefinitions();

  it("expõe os comandos de gravação e configuração", () => {
    expect(commandDefinitions.map((command) => command.toJSON().name)).toEqual([
      "record",
      "stop",
      "recording-role",
      "recording-summary-forum",
      "recording-profile",
      "recording-activate",
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

  it("registra descrições em inglês com tradução pt-BR em comandos, subcomandos e opções", () => {
    const missing: string[] = [];
    const visit = (node: DescribedNode, path: string): void => {
      const portuguese = node.description_localizations?.["pt-BR"];
      if (portuguese === undefined || portuguese === null || portuguese.length === 0) {
        missing.push(path);
      }
      for (const option of node.options ?? []) visit(option, `${path} ${option.name}`);
    };
    for (const command of commandDefinitions) {
      const definition = command.toJSON();
      visit(definition, `/${definition.name}`);
    }

    expect(missing).toEqual([]);
    expect(commandDefinitions[0]?.toJSON()).toMatchObject({
      description: "Starts recording the voice channel you are in",
      description_localizations: { "pt-BR": "Inicia a gravação do canal de voz em que você está" },
    });
  });

  it("mantém a referência do dashboard alinhada aos comandos registrados", () => {
    const registeredPaths = commandDefinitions.flatMap((command) => {
      const definition = command.toJSON();
      const subcommands = definition.options?.filter((option) => option.type === 1) ?? [];
      return subcommands.length === 0
        ? [`/${definition.name}`]
        : subcommands.map((subcommand) => `/${definition.name} ${subcommand.name}`);
    });
    const referencePaths = createCommandReference().flatMap((group) =>
      group.commands.map((command) => command.name),
    );

    expect(referencePaths.toSorted()).toEqual(registeredPaths.toSorted());
  });

  it("describes every reference group and command in English and pt-BR", () => {
    const reference = createCommandReference();

    expect(reference[0]).toEqual({
      commands: [
        {
          description: {
            en: "Starts recording the voice channel you are in",
            "pt-BR": "Inicia a gravação do canal de voz em que você está",
          },
          name: "/record",
        },
        {
          description: {
            en: "Stops recording the voice channel you are in",
            "pt-BR": "Encerra a gravação do canal de voz em que você está",
          },
          name: "/stop",
        },
      ],
      id: "recording",
      label: { en: "Recording", "pt-BR": "Gravação" },
    });
    expect(reference.map((group) => group.id)).toEqual(["recording", "administrative"]);
    expect(reference[1]?.label).toEqual({
      en: "Administrative shortcuts",
      "pt-BR": "Atalhos administrativos",
    });
    expect(reference[1]?.commands).toContainEqual({
      description: {
        en: "Confirms the server forum, AI profile, and recording permissions after an ownership change",
        "pt-BR": "Confirma o fórum, o perfil de IA e as permissões após troca de dono",
      },
      name: "/recording-activate",
    });
  });
});

interface DescribedNode {
  description_localizations?: Partial<Record<string, string | null>> | null | undefined;
  options?: readonly (DescribedNode & { name: string })[] | undefined;
}
