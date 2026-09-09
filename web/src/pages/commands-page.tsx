import { CircleHelp } from "lucide-react";

import { Card, RailLabel } from "../components/ui";
import { useDashboard } from "../layout/dashboard-layout";
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

export function CommandsPage() {
  const { controls } = useDashboard();
  return (
    <>
      <TopBar actions={controls} meta="Registrados pelo bot no Discord" title="Comandos" />
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
        <Card>
          <div className="flex items-start gap-3">
            <CircleHelp className="mt-0.5 size-4 shrink-0 text-accent" />
            <div>
              <h2 className="m-0 text-[14px] font-semibold text-ink">
                O dashboard é a fonte da verdade
              </h2>
              <p className="m-0 mt-1 text-[12.5px] leading-relaxed text-ink-muted">
                A configuração completa vive aqui. Os comandos continuam no Discord para quem já
                está na call.
              </p>
              <p className="m-0 mt-3 text-[12.5px] leading-relaxed text-ink-muted">
                Os nomes exatos registrados pelo bot são mantidos em{" "}
                <code className="rounded bg-surface-inset px-1.5 py-0.5 font-mono text-[11px]">
                  BOT_COMMANDS.md
                </code>{" "}
                no repositório.
              </p>
            </div>
          </div>
        </Card>
      </Screen>
    </>
  );
}
