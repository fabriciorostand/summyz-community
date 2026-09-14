import { RailLabel } from "../components/ui";
import { TopBar } from "../layout/top-bar";
import { Screen } from "./screen";

const groups = [
  {
    commands: [
      ["/record start", "Inicia a gravação no canal de voz atual."],
      ["/record stop", "Finaliza a gravação e inicia o processamento."],
      ["/record status", "Mostra o estado da reunião em andamento."],
    ],
    label: "Gravação",
  },
  {
    commands: [
      ["/config forum", "Define o fórum de resumos sem sair do Discord."],
      ["/config role", "Ajusta as permissões de gravação."],
    ],
    label: "Atalhos administrativos",
  },
  {
    commands: [
      ["/recording-cost meeting", "Custo de uma reunião concluída."],
      ["/recording-cost period", "Agrega reuniões concluídas por data de início."],
    ],
    label: "Custo — só para o dono do servidor",
  },
] as const;

/** Static reference; the canonical names live in BOT_COMMANDS.md at the repository root. */
export function CommandsPage() {
  return (
    <>
      <TopBar meta="Registrados pelo bot no Discord" title="Comandos" />
      <Screen width="narrow">
        {groups.map((group) => (
          <div key={group.label}>
            <RailLabel>{group.label}</RailLabel>
            <div className="overflow-hidden rounded-xl border border-line bg-surface">
              {group.commands.map(([name, description]) => (
                <div
                  className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-line-soft px-4 py-3 last:border-0"
                  key={name}
                >
                  <code className="font-mono text-[12.5px] text-accent">{name}</code>
                  <span className="text-[12.5px] text-ink-muted">{description}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </Screen>
    </>
  );
}
