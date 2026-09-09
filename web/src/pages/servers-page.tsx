import { ArrowRight, CircleCheck, CircleDashed, ExternalLink, RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";

import { EmptyState, ErrorState, LoadingPanel } from "../components/states";
import { Avatar, Button, Card } from "../components/ui";
import { useDashboard } from "../layout/dashboard-layout";
import { TopBar } from "../layout/top-bar";
import type { Guild } from "../lib/api";
import { formatInteger } from "../lib/format";
import { Screen } from "./screen";

export function ServersPage() {
  const { guilds } = useDashboard();
  const all = guilds.allGuilds;
  const installed = all?.filter((guild) => guild.installed).length ?? 0;
  return (
    <>
      <TopBar
        actions={
          <Button onClick={guilds.reload} type="button" variant="secondary">
            <RefreshCw className="size-3.5" />
            Atualizar lista
          </Button>
        }
        meta={
          all === undefined
            ? undefined
            : `${String(installed)} instalado · ${String(all.length - installed)} disponíveis`
        }
        title="Servidores"
      />
      <Screen>
        <p className="m-0 max-w-2xl text-[13px] leading-relaxed text-ink-muted">
          Aparecem aqui os servidores dos quais sua conta Discord é proprietária. Instale o bot para
          liberar a configuração.
        </p>
        {guilds.error ? (
          <ErrorState
            code="request_failed"
            onRetry={guilds.reload}
            secondaryAction={
              <Link
                className="rounded-lg border border-line bg-surface-raised px-3.5 py-2 text-[13.5px] text-ink"
                to="/account"
              >
                Ver conexão Discord
              </Link>
            }
            title="Servidores indisponíveis"
          >
            Confira a conexão da sua conta Discord e tente novamente.
          </ErrorState>
        ) : all === undefined ? (
          <LoadingPanel label="Carregando servidores…" />
        ) : all.length === 0 ? (
          <EmptyState
            action={
              <Link
                className="rounded-lg bg-action px-3.5 py-2 text-[13.5px] font-medium text-white"
                to="/account"
              >
                Conectar o Discord
              </Link>
            }
            title="Nenhum servidor encontrado"
          >
            Conecte sua conta do Discord para encontrarmos os servidores que você administra.
          </EmptyState>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
            {all.map((guild) => (
              <GuildCard guild={guild} key={guild.id} />
            ))}
          </div>
        )}
      </Screen>
    </>
  );
}

function GuildCard({ guild }: { guild: Guild }) {
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <Avatar avatarUrl={guild.iconUrl} name={guild.name} size={40} />
        <div className="min-w-0 flex-1">
          <h3 className="m-0 truncate text-[15px] font-semibold tracking-tight text-ink">
            {guild.name}
          </h3>
          <div className="mt-1 flex items-center gap-1.5 text-[11.5px]">
            {guild.installed ? (
              <>
                <CircleCheck className="size-3.5 text-ok" />
                <span className="text-ok">Instalado e configurado</span>
              </>
            ) : (
              <>
                <CircleDashed className="size-3.5 text-ink-dim" />
                <span className="text-ink-muted">Bot não instalado</span>
              </>
            )}
          </div>
        </div>
      </div>
      {guild.installed ? (
        <>
          <div className="flex flex-col">
            <GuildFact label="Perfil ativo" value={guild.activeProfile?.name ?? "Nenhum"} />
            <GuildFact
              label="Fórum de resumos"
              value={guild.summaryForum?.name ?? "Não configurado"}
            />
            <GuildFact
              label="Calls registradas"
              value={guild.callCount == null ? "—" : formatInteger(guild.callCount)}
            />
          </div>
          <Link
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-action px-3.5 py-2 text-[13.5px] font-medium text-white transition-colors hover:bg-action-hover"
            to={`/guilds/${guild.id}`}
          >
            Configurar
            <ArrowRight className="size-3.5" />
          </Link>
        </>
      ) : (
        <>
          <p className="m-0 text-[12.5px] leading-relaxed text-ink-muted">
            Instale o Summyz neste servidor para gravar calls e publicar resumos.
          </p>
          <a
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-line bg-surface-raised px-3.5 py-2 text-[13.5px] font-medium text-ink transition-colors hover:border-line-strong"
            href={guild.installUrl}
            rel="noreferrer"
            target="_blank"
          >
            Instalar no Discord
            <ExternalLink className="size-3.5" />
          </a>
        </>
      )}
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
