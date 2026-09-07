import {
  Cable,
  ChevronRight,
  CircleHelp,
  ExternalLink,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";

import { api, type DiscordConnection, type Guild, type User } from "./api";
import { Button, EmptyState, Loading } from "./components";

import { Page } from "./dashboard-shared";

export function GuildsPage() {
  const [guilds, setGuilds] = useState<Guild[]>();
  const [loadError, setLoadError] = useState(false);
  useEffect(() => {
    void api
      .listGuilds()
      .then(setGuilds)
      .catch(() => setLoadError(true));
  }, []);
  if (loadError) {
    return (
      <Page
        title="Não foi possível carregar seus servidores"
        eyebrow="Conexão Discord"
        description="Confira a conexão da sua conta Discord e tente novamente."
      >
        <EmptyState title="Servidores indisponíveis">
          <Link to="/account">Ver conexão Discord</Link>
        </EmptyState>
      </Page>
    );
  }
  if (guilds === undefined) return <Loading />;
  return (
    <Page
      title="Seus servidores"
      eyebrow="Visão geral"
      description="Escolha onde você quer configurar o Summyz Community. Só aparecem servidores dos quais sua conta Discord é proprietária."
    >
      {guilds.length === 0 ? (
        <EmptyState title="Conecte sua conta Discord">
          Vá até Minha conta para encontrar os servidores que você administra.
        </EmptyState>
      ) : (
        <div className="guild-grid">
          {guilds.map((guild) => (
            <article className="guild-card" key={guild.id}>
              <div className="guild-icon">
                {guild.iconUrl === null ? (
                  guild.name.slice(0, 2).toUpperCase()
                ) : (
                  <img alt="" src={guild.iconUrl} />
                )}
              </div>
              <div>
                <h3>{guild.name}</h3>
                <p>
                  {guild.installed
                    ? "Summyz instalado e pronto para configurar"
                    : "Instale o bot para liberar a configuração"}
                </p>
              </div>
              {guild.installed ? (
                <Link className="card-action" to={`/guilds/${guild.id}`}>
                  <span>Configurar</span>
                  <ChevronRight />
                </Link>
              ) : (
                <a
                  className="card-action install"
                  href={guild.installUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  <span>Instalar</span>
                  <ExternalLink />
                </a>
              )}
            </article>
          ))}
        </div>
      )}
    </Page>
  );
}

export function AccountPage() {
  const user = useOutletContext<User>();
  const [busy, setBusy] = useState(false);
  const [connection, setConnection] = useState<DiscordConnection>();
  const [connectionError, setConnectionError] = useState(false);
  useEffect(() => {
    let active = true;
    void api
      .getDiscordConnection()
      .then((next) => {
        if (active) setConnection(next);
      })
      .catch(() => {
        if (active) setConnectionError(true);
      });
    return () => {
      active = false;
    };
  }, []);
  async function connect() {
    setBusy(true);
    setConnectionError(false);
    try {
      const { authorizationUrl } = await api.connectDiscord();
      window.location.assign(authorizationUrl);
    } catch {
      setConnectionError(true);
      setBusy(false);
    }
  }
  async function disconnect() {
    setBusy(true);
    setConnectionError(false);
    try {
      await api.disconnectDiscord();
      setConnection({ connected: false });
    } catch {
      setConnectionError(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Page
      title="Minha conta"
      eyebrow="Identidade"
      description="Sua conta do dashboard e a identidade Discord usada para localizar servidores."
    >
      <section className="panel">
        <div className="panel-title">
          <div className="round-icon">
            <UserRound />
          </div>
          <div>
            <h2>Conta Summyz Community</h2>
            <p>{user.email}</p>
          </div>
          <span className="status good">
            <ShieldCheck /> E-mail verificado
          </span>
        </div>
      </section>
      <DiscordConnectionPanel
        busy={busy}
        connection={connection}
        connectionError={connectionError}
        connect={connect}
        disconnect={disconnect}
      />
    </Page>
  );
}

function DiscordConnectionPanel({
  busy,
  connection,
  connectionError,
  connect,
  disconnect,
}: {
  busy: boolean;
  connection: DiscordConnection | undefined;
  connectionError: boolean;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
}) {
  return (
    <section className="panel">
      <div className="panel-title">
        <div className="round-icon discord">
          <Cable />
        </div>
        <div>
          <h2>Discord</h2>
          <p>{connectionDescription(connection)}</p>
        </div>
        {connection?.connected === true && (
          <span className="status good">
            <ShieldCheck /> Discord conectado
          </span>
        )}
      </div>
      {connection === undefined && !connectionError && <p>Verificando conexão…</p>}
      {connectionError && (
        <p className="form-error" role="alert">
          Não foi possível consultar ou alterar a conexão Discord. Tente novamente.
        </p>
      )}
      <DiscordConnectionAction
        busy={busy}
        connection={connection}
        connect={connect}
        disconnect={disconnect}
      />
    </section>
  );
}

function connectionDescription(connection: DiscordConnection | undefined): string {
  if (connection?.connected === true) return `Conectado como ${connection.discordUsername}.`;
  return "Conecte para encontrar servidores dos quais você é dono.";
}

function DiscordConnectionAction({
  busy,
  connection,
  connect,
  disconnect,
}: {
  busy: boolean;
  connection: DiscordConnection | undefined;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
}) {
  if (connection?.connected === true) {
    return (
      <Button className="secondary" disabled={busy} onClick={disconnect}>
        {busy ? "Desconectando…" : "Desconectar Discord"}
      </Button>
    );
  }
  if (connection === undefined) return null;
  return (
    <Button disabled={busy} onClick={connect}>
      {busy ? "Abrindo Discord…" : "Conectar ao Discord"}
    </Button>
  );
}

export function CommandsPage() {
  const commands = [
    ["/record start", "Inicia a gravação no canal de voz atual."],
    ["/record stop", "Finaliza a gravação e inicia o processamento."],
    ["/record status", "Mostra o estado da reunião em andamento."],
    ["/config forum", "Atalho administrativo para o fórum de resumos."],
    ["/config role", "Atalho administrativo para permissões de gravação."],
  ];
  return (
    <Page
      title="Comandos do bot"
      eyebrow="Referência"
      description="O dashboard concentra a configuração; os comandos continuam disponíveis dentro do Discord."
    >
      <div className="command-list">
        {commands.map(([name, description]) => (
          <article key={name}>
            <code>{name}</code>
            <p>{description}</p>
          </article>
        ))}
      </div>
      <div className="notice">
        <CircleHelp />
        <p>
          Os nomes exatos registrados pelo bot são mantidos no arquivo BOT_COMMANDS.md do projeto.
        </p>
      </div>
    </Page>
  );
}
