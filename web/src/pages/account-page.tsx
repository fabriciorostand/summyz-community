import { Cable, ShieldCheck } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";

import {
  Avatar,
  Badge,
  Button,
  Card,
  Field,
  FormError,
  SectionHeading,
  SelectField,
} from "../components/ui";
import { useDashboard } from "../layout/dashboard-layout";
import { TopBar } from "../layout/top-bar";
import { ApiError, api, type DiscordConnection } from "../lib/api";
import { Screen } from "./screen";

export function AccountPage() {
  const { controls, user } = useDashboard();
  return (
    <>
      <TopBar actions={controls} title="Minha conta" />
      <Screen width="narrow">
        <Card>
          <div className="flex flex-wrap items-center gap-4">
            <Avatar name={user.email} size={44} />
            <div className="min-w-0 flex-1">
              <h2 className="m-0 truncate text-[16px] font-semibold tracking-tight text-ink">
                {user.email}
              </h2>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                {user.emailVerified && (
                  <span className="flex items-center gap-1.5 text-[11.5px] text-ok">
                    <ShieldCheck className="size-3.5" />
                    E-mail verificado
                  </span>
                )}
                <Badge>
                  {user.installationRole === "administrator"
                    ? "Administrador da instalação"
                    : "Membro"}
                </Badge>
              </div>
            </div>
          </div>
        </Card>
        <DiscordCard />
        <PreferencesCard />
        <PasswordCard />
      </Screen>
    </>
  );
}

function DiscordCard() {
  const [connection, setConnection] = useState<DiscordConnection>();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    void api
      .getDiscordConnection()
      .then((next) => {
        if (active) setConnection(next);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, []);

  async function connect() {
    setBusy(true);
    setFailed(false);
    try {
      const { authorizationUrl } = await api.connectDiscord();
      window.location.assign(authorizationUrl);
    } catch {
      setFailed(true);
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    setFailed(false);
    try {
      await api.disconnectDiscord();
      setConnection({ connected: false });
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <SectionHeading
        description={
          connection?.connected === true
            ? `Conectado como ${connection.discordUsername}. Usamos essa identidade para listar os servidores dos quais você é dono.`
            : "Conecte para encontrar os servidores dos quais você é dono."
        }
        icon={<Cable className="size-4" />}
        title="Discord"
      />
      {failed && (
        <div className="mb-3">
          <FormError>
            Não foi possível consultar ou alterar a conexão Discord. Tente novamente.
          </FormError>
        </div>
      )}
      {connection === undefined && !failed ? (
        <p className="m-0 text-[12.5px] text-ink-muted">Verificando conexão…</p>
      ) : connection?.connected === true ? (
        <Button disabled={busy} onClick={() => void disconnect()} type="button" variant="secondary">
          {busy ? "Desconectando…" : "Desconectar"}
        </Button>
      ) : (
        <Button disabled={busy} onClick={() => void connect()} type="button">
          {busy ? "Abrindo Discord…" : "Conectar ao Discord"}
        </Button>
      )}
    </Card>
  );
}

function PreferencesCard() {
  const { setPreferences, theme, user } = useDashboard();
  return (
    <Card>
      <SectionHeading
        description="Valem só para você, em todos os servidores."
        title="Preferências"
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField
          label="Idioma do dashboard"
          onChange={(event) =>
            setPreferences({
              dashboardLanguage: event.currentTarget.value === "en" ? "en" : "pt-BR",
              dashboardTheme: theme,
            })
          }
          value={user.dashboardLanguage}
        >
          <option value="pt-BR">Português (Brasil)</option>
          <option value="en">English</option>
        </SelectField>
        <SelectField
          label="Tema"
          onChange={(event) => {
            const value = event.currentTarget.value;
            setPreferences({
              dashboardLanguage: user.dashboardLanguage,
              dashboardTheme: value === "light" || value === "dark" ? value : "system",
            });
          }}
          value={theme}
        >
          <option value="dark">Escuro</option>
          <option value="light">Claro</option>
          <option value="system">Seguir o sistema</option>
        </SelectField>
      </div>
    </Card>
  );
}

function PasswordCard() {
  const [error, setError] = useState<string>();
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(undefined);
    setDone(false);
    try {
      await api.changePassword(
        String(form.get("currentPassword")),
        String(form.get("newPassword")),
      );
      setDone(true);
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.status === 401
          ? "A senha atual não confere."
          : "Não foi possível trocar a senha.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Card>
        <SectionHeading title="Trocar senha" />
        <p className="m-0 text-[12.5px] text-ink-muted">
          Senha alterada. Sua sessão foi encerrada — entre novamente com a nova senha.
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <SectionHeading description="Trocar a senha encerra a sessão atual." title="Trocar senha" />
      <form className="flex flex-col gap-3" onSubmit={(event) => void submit(event)}>
        <Field
          autoComplete="current-password"
          label="Senha atual"
          name="currentPassword"
          required
          type="password"
        />
        <Field
          autoComplete="new-password"
          hint="Mínimo de 12 caracteres."
          label="Nova senha"
          minLength={12}
          name="newPassword"
          required
          type="password"
        />
        {error !== undefined && <FormError>{error}</FormError>}
        <Button className="self-start" disabled={busy} type="submit">
          {busy ? "Salvando…" : "Salvar nova senha"}
        </Button>
      </form>
    </Card>
  );
}
