import { ArrowRight, ArrowUpRight, CircleAlert, CircleCheck, RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";

import {
  ErrorState,
  InstallBotLink,
  LoadingPanel,
  NoServerState,
  secondaryLinkClass,
} from "../components/states";
import { Avatar, Button, Card, DiscordIcon } from "../components/ui";
import { useBotInstallation } from "../hooks/use-bot-installation";
import { useDashboard } from "../layout/dashboard-layout";
import { TopBar } from "../layout/top-bar";
import type { Guild } from "../lib/api";
import { formatInteger } from "../lib/format";
import { Screen } from "./screen";

/** The bot decides which servers show up here: whatever it is in, nothing else. */
export function ServersPage() {
  const { guilds } = useDashboard();
  const { installUrl } = useBotInstallation();
  const list = guilds.guilds;
  return (
    <>
      <TopBar
        actions={
          <Button onClick={guilds.reload} type="button" variant="secondary">
            <RefreshCw className="size-3.5" />
            Atualizar lista
          </Button>
        }
        title="Servidores"
        wrappedActionsAlign="start"
      />
      <Screen>
        {guilds.error ? (
          <ErrorState
            code="request_failed"
            onRetry={guilds.reload}
            secondaryAction={
              <Link className={secondaryLinkClass} to="/installation">
                Ver instalação
              </Link>
            }
            title="Servidores indisponíveis"
          >
            O bot não conseguiu listar os servidores em que está. Confira o token em Instalação e
            tente novamente.
          </ErrorState>
        ) : list === undefined ? (
          <LoadingPanel label="Carregando servidores…" />
        ) : list.length === 0 ? (
          <NoServerState installUrl={installUrl} />
        ) : (
          <>
            <div>
              <InstallBotLink installUrl={installUrl} variant="secondary">
                Adicionar o bot ao Discord
              </InstallBotLink>
            </div>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
              {list.map((guild) => (
                <GuildCard guild={guild} key={guild.id} />
              ))}
              <AddServerCard installUrl={installUrl} />
            </div>
          </>
        )}
      </Screen>
    </>
  );
}

function GuildCard({ guild }: { guild: Guild }) {
  const configured = guild.activeProfile != null && guild.summaryForum != null;
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <Avatar avatarUrl={guild.iconUrl} name={guild.name} size={40} />
        <div className="min-w-0 flex-1">
          <h3 className="m-0 truncate text-[15px] font-semibold tracking-tight text-ink">
            {guild.name}
          </h3>
          <div className="mt-1 flex items-center gap-1.5 text-[11.5px]">
            {configured ? (
              <>
                <CircleCheck className="size-3.5 text-ok" />
                <span className="text-ok">Instalado e configurado</span>
              </>
            ) : (
              <>
                <CircleAlert className="size-3.5 text-warn" />
                <span className="text-warn">Falta configurar</span>
              </>
            )}
          </div>
        </div>
      </div>
      <div className="flex flex-col">
        <GuildFact label="Perfil ativo" value={guild.activeProfile?.name ?? "Nenhum"} />
        <GuildFact label="Fórum de resumos" value={guild.summaryForum?.name ?? "Não configurado"} />
        <GuildFact
          label="Calls no período"
          value={guild.callCount == null ? "—" : formatInteger(guild.callCount)}
        />
      </div>
      <Link
        className="inline-flex items-center justify-center gap-2 rounded-lg bg-action-gradient px-3.5 py-2 text-[13.5px] font-medium text-white transition-colors hover:bg-action-gradient-hover"
        to={`/guilds/${guild.id}`}
      >
        Configurar
        <ArrowRight className="size-3.5" />
      </Link>
    </Card>
  );
}

function GuildFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line-soft py-2 last:border-0">
      <span className="text-[12px] text-ink-muted">{label}</span>
      <span className="truncate text-right text-[12px] text-ink-secondary">{value}</span>
    </div>
  );
}

/** Dashed card at the end of the grid: the authorization happens on Discord, not here. */
function AddServerCard({ installUrl }: { installUrl: string | undefined }) {
  const body = (
    <>
      <span className="grid size-10 place-items-center rounded-xl bg-surface-inset text-ink-muted">
        <DiscordIcon className="size-5" />
      </span>
      <span className="flex flex-col gap-1">
        <strong className="text-[14px] font-semibold tracking-tight text-ink">
          Adicionar o bot a um servidor
        </strong>
        <span className="text-[12.5px] leading-relaxed text-ink-muted">
          Abre a autorização oficial do Discord, onde você escolhe o servidor.
        </span>
      </span>
      <span className="mt-auto inline-flex items-center gap-1 text-[12.5px] text-accent">
        Autorizar no Discord <ArrowUpRight className="size-3.5" />
      </span>
    </>
  );
  const className =
    "flex flex-col gap-3 rounded-xl border border-dashed border-line-strong bg-transparent p-5 transition-colors";
  if (installUrl === undefined) {
    return (
      <div aria-disabled="true" className={`${className} opacity-60`}>
        {body}
      </div>
    );
  }
  return (
    <a
      aria-label="Adicionar o bot a um servidor"
      className={`${className} hover:border-action/60 hover:bg-surface`}
      href={installUrl}
      rel="noreferrer"
      target="_blank"
    >
      {body}
    </a>
  );
}
