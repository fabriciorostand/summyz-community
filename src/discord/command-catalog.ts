export type CommandLanguage = "en" | "pt-BR";

type LocalizedText = Readonly<Record<CommandLanguage, string>>;

interface CatalogEntry {
  readonly description: LocalizedText;
  readonly name: string;
}

const localized = (en: string, portuguese: string): LocalizedText => ({
  en,
  "pt-BR": portuguese,
});

export const commandCatalog = {
  record: {
    description: localized(
      "Starts recording the voice channel you are in",
      "Inicia a gravação do canal de voz em que você está",
    ),
    name: "record",
  },
  recordingCost: {
    description: localized(
      "Shows confirmed AI processing costs",
      "Mostra os custos confirmados do processamento por IA",
    ),
    name: "recording-cost",
    subcommands: {
      meeting: {
        description: localized(
          "Shows costs for a completed meeting",
          "Mostra os custos de uma reunião concluída",
        ),
        name: "meeting",
        options: {
          id: {
            description: localized("Meeting ID", "ID da reunião"),
            name: "id",
          },
        },
      },
      period: {
        description: localized(
          "Shows costs for meetings started in a period",
          "Mostra os custos das reuniões iniciadas em um período",
        ),
        name: "period",
        options: {
          from: {
            description: localized(
              "First meeting date (YYYY-MM-DD)",
              "Primeira data de reunião (AAAA-MM-DD)",
            ),
            name: "from",
          },
          to: {
            description: localized(
              "Last meeting date (YYYY-MM-DD)",
              "Última data de reunião (AAAA-MM-DD)",
            ),
            name: "to",
          },
        },
      },
    },
  },
  recordingRole: {
    description: localized(
      "Configures the roles that can control recordings",
      "Configura os cargos que podem controlar gravações",
    ),
    name: "recording-role",
    subcommands: {
      add: {
        description: localized(
          "Allows a role to start and stop recordings",
          "Autoriza um cargo a iniciar e encerrar gravações",
        ),
        name: "add",
        options: {
          role: {
            description: localized("Role that will be authorized", "Cargo que será autorizado"),
            name: "role",
          },
        },
      },
      list: {
        description: localized(
          "Lists the authorized roles in this server",
          "Lista os cargos autorizados neste servidor",
        ),
        name: "list",
      },
      remove: {
        description: localized(
          "Removes authorization from a role",
          "Remove a autorização de um cargo",
        ),
        name: "remove",
        options: {
          role: {
            description: localized(
              "Role that will no longer be authorized",
              "Cargo que deixará de ser autorizado",
            ),
            name: "role",
          },
        },
      },
    },
  },
  recordingSummaryForum: {
    description: localized(
      "Configures the forum used to publish summaries and transcripts",
      "Configura o fórum usado para publicar resumos e transcrições",
    ),
    name: "recording-summary-forum",
    subcommands: {
      clear: {
        description: localized(
          "Removes the forum and blocks recordings until another is configured",
          "Remove o fórum e bloqueia novas gravações até outra configuração",
        ),
        name: "clear",
      },
      set: {
        description: localized(
          "Sets the summary and transcript forum",
          "Define o fórum de resumos e transcrições",
        ),
        name: "set",
        options: {
          forum: {
            description: localized(
              "Forum that will receive the posts",
              "Fórum que receberá as publicações",
            ),
            name: "forum",
          },
          tag: {
            description: localized(
              "Name or ID of an existing forum tag",
              "Nome ou identificador de uma tag existente no fórum",
            ),
            name: "tag",
          },
        },
      },
      show: {
        description: localized(
          "Shows the forum configured in this server",
          "Mostra o fórum configurado neste servidor",
        ),
        name: "show",
      },
    },
  },
  stop: {
    description: localized(
      "Stops recording the voice channel you are in",
      "Encerra a gravação do canal de voz em que você está",
    ),
    name: "stop",
  },
} as const;

function rootReference(entry: CatalogEntry) {
  return {
    description: entry.description.en,
    name: `/${entry.name}`,
  };
}

function subcommandReference(command: CatalogEntry, subcommand: CatalogEntry) {
  return {
    description: subcommand.description.en,
    name: `/${command.name} ${subcommand.name}`,
  };
}

export function createCommandReference() {
  const { record, recordingCost, recordingRole, recordingSummaryForum, stop } = commandCatalog;
  return [
    {
      commands: [rootReference(record), rootReference(stop)],
      id: "recording",
      label: "Recording",
    },
    {
      commands: [
        subcommandReference(recordingSummaryForum, recordingSummaryForum.subcommands.set),
        subcommandReference(recordingSummaryForum, recordingSummaryForum.subcommands.show),
        subcommandReference(recordingSummaryForum, recordingSummaryForum.subcommands.clear),
        subcommandReference(recordingRole, recordingRole.subcommands.add),
        subcommandReference(recordingRole, recordingRole.subcommands.remove),
        subcommandReference(recordingRole, recordingRole.subcommands.list),
      ],
      id: "administrative",
      label: "Administrative shortcuts",
    },
    {
      commands: [
        subcommandReference(recordingCost, recordingCost.subcommands.meeting),
        subcommandReference(recordingCost, recordingCost.subcommands.period),
      ],
      id: "cost",
      label: "Cost — server owner only",
    },
  ];
}
