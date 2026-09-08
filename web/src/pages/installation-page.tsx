import {
  Cable,
  CircleAlert,
  CircleCheck,
  CircleX,
  KeyRound,
  Lock,
  Mail,
  UserPlus,
} from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";

import { LoadingPanel } from "../components/states";
import { Button, Card, Field, Notice, SectionHeading, Toggle } from "../components/ui";
import { useDashboard } from "../layout/dashboard-layout";
import { TopBar } from "../layout/top-bar";
import { api, type InstallationHealth, type InstallationSettings } from "../lib/api";
import { formatInteger } from "../lib/format";
import { Screen } from "./screen";

const emptySmtp = {
  fromEmail: "",
  fromName: "Summyz Community",
  host: "smtp-relay.brevo.com",
  port: 587,
  replyTo: null,
  secure: false,
  user: "",
} as const;

export function InstallationPage() {
  const { controls } = useDashboard();
  const [settings, setSettings] = useState<InstallationSettings>();
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api.getInstallationSettings().then(setSettings, () => setSettings(undefined));
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (settings === undefined) return;
    const { secrets: _secrets, setupCompleted: _setupCompleted, ...value } = settings;
    setBusy(true);
    try {
      await api.updateInstallationSettings(value);
      setSaved(true);
      setTimeout(() => setSaved(false), 1_800);
    } finally {
      setBusy(false);
    }
  }

  const smtp = settings?.smtp ?? emptySmtp;
  return (
    <>
      <TopBar
        actions={
          <>
            {saved && <span className="text-[12.5px] text-ok">Alterações salvas</span>}
            <Button disabled={busy} form="installation-form" type="submit">
              {busy ? "Salvando…" : "Salvar instalação"}
            </Button>
            {controls}
          </>
        }
        meta="Credenciais globais"
        title="Instalação"
      />
      <Screen width="narrow">
        {settings === undefined ? (
          <LoadingPanel label="Carregando a instalação…" />
        ) : (
          <form
            className="flex flex-col gap-4"
            id="installation-form"
            onSubmit={(event) => void save(event)}
          >
            <Card>
              <SectionHeading icon={<Cable className="size-4" />} title="Aplicação Discord" />
              <div className="flex flex-col gap-3">
                <Field
                  label="Client ID"
                  onChange={(event) =>
                    setSettings({ ...settings, discordClientId: event.currentTarget.value || null })
                  }
                  value={settings.discordClientId ?? ""}
                />
                <SecretField
                  configured={settings.secrets.discordBotToken}
                  label="Token do bot"
                  name="discord_bot_token"
                />
                <SecretField
                  configured={settings.secrets.discordClientSecret}
                  label="Client secret"
                  name="discord_client_secret"
                />
                <Field
                  label="URL pública"
                  onChange={(event) =>
                    setSettings({ ...settings, publicBaseUrl: event.currentTarget.value || null })
                  }
                  type="url"
                  value={settings.publicBaseUrl ?? ""}
                />
              </div>
            </Card>

            <Card>
              <SectionHeading icon={<KeyRound className="size-4" />} title="Provedores" />
              <div className="flex flex-col gap-3">
                <SecretField
                  configured={settings.secrets.openRouterApiKey}
                  label="Chave OpenRouter"
                  name="openrouter_api_key"
                />
                <Notice icon={<Lock className="mt-0.5 size-3.5 shrink-0" />}>
                  Segredos são criptografados antes de chegarem ao banco e nunca voltam em texto
                  claro.
                </Notice>
              </div>
            </Card>

            <Card>
              <SectionHeading icon={<UserPlus className="size-4" />} title="Acesso" />
              <Toggle
                checked={settings.registrationEnabled}
                description="Qualquer pessoa pode criar conta. Servidores continuam limitados aos proprietários."
                label="Cadastro público"
                onChange={(registrationEnabled) =>
                  setSettings({ ...settings, registrationEnabled })
                }
              />
            </Card>

            <Card>
              <SectionHeading
                description="Necessário para verificar cadastros e redefinir senhas. Compatível com Brevo e outros provedores."
                icon={<Mail className="size-4" />}
                title="E-mail SMTP"
              />
              <div className="flex flex-col gap-3">
                <Toggle
                  checked={settings.smtp !== null}
                  label="Envio de e-mail ativo"
                  onChange={(enabled) =>
                    setSettings({ ...settings, smtp: enabled ? { ...emptySmtp } : null })
                  }
                />
                {settings.smtp !== null && (
                  <>
                    <div className="grid gap-3 sm:grid-cols-[1fr_120px]">
                      <Field
                        label="Servidor SMTP"
                        onChange={(event) =>
                          setSettings({
                            ...settings,
                            smtp: { ...smtp, host: event.currentTarget.value },
                          })
                        }
                        value={smtp.host}
                      />
                      <Field
                        label="Porta"
                        min={1}
                        onChange={(event) =>
                          setSettings({
                            ...settings,
                            smtp: { ...smtp, port: event.currentTarget.valueAsNumber },
                          })
                        }
                        type="number"
                        value={smtp.port}
                      />
                    </div>
                    <Field
                      label="Login SMTP"
                      onChange={(event) =>
                        setSettings({
                          ...settings,
                          smtp: { ...smtp, user: event.currentTarget.value },
                        })
                      }
                      value={smtp.user}
                    />
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field
                        label="E-mail remetente"
                        onChange={(event) =>
                          setSettings({
                            ...settings,
                            smtp: { ...smtp, fromEmail: event.currentTarget.value },
                          })
                        }
                        type="email"
                        value={smtp.fromEmail}
                      />
                      <Field
                        label="Nome do remetente"
                        onChange={(event) =>
                          setSettings({
                            ...settings,
                            smtp: { ...smtp, fromName: event.currentTarget.value },
                          })
                        }
                        value={smtp.fromName}
                      />
                    </div>
                    <SecretField
                      configured={settings.secrets.smtpPassword}
                      label="Senha SMTP"
                      name="smtp_password"
                    />
                    <Toggle
                      checked={smtp.secure}
                      description="Use com a porta 465. Na 587, mantenha desativado para STARTTLS."
                      label="TLS implícito"
                      onChange={(secure) => setSettings({ ...settings, smtp: { ...smtp, secure } })}
                    />
                  </>
                )}
              </div>
            </Card>
          </form>
        )}
        <HealthCard />
      </Screen>
    </>
  );
}

function SecretField({
  configured,
  label,
  name,
}: {
  configured: boolean;
  label: string;
  name: string;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (value === "") return;
    setBusy(true);
    try {
      await api.updateSecret(name, value);
      setValue("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-end gap-2">
      <Field
        className="flex-1"
        label={label}
        onChange={(event) => setValue(event.currentTarget.value)}
        placeholder={configured ? "Configurado — digite para substituir" : "Ainda não configurado"}
        type="password"
        value={value}
      />
      <Button
        disabled={busy || value === ""}
        onClick={() => void save()}
        type="button"
        variant="secondary"
      >
        Atualizar
      </Button>
    </div>
  );
}

const componentLabels: Record<string, string> = {
  bot: "Bot autenticado no Discord",
  database: "Banco de dados",
  faster_whisper: "faster-whisper",
  ffmpeg: "FFmpeg com libopus",
  ollama: "Ollama",
  openrouter: "OpenRouter",
  queue: "Fila durável de processamento",
  smtp: "Envio de e-mail",
  worker: "Worker de processamento",
};

function HealthCard() {
  const [health, setHealth] = useState<InstallationHealth>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    void api.getInstallationHealth().then(setHealth, () => setFailed(true));
  }, []);

  return (
    <Card>
      <h2 className="m-0 mb-3 text-[15px] font-semibold tracking-tight text-ink">
        Estado da instalação
      </h2>
      {failed ? (
        <p className="m-0 text-[12.5px] text-ink-muted">
          Não foi possível consultar o estado dos componentes.
        </p>
      ) : health === undefined ? (
        <p className="m-0 text-[12.5px] text-ink-muted">Consultando componentes…</p>
      ) : (
        <div className="flex flex-col gap-2">
          <HealthRow
            detail={`migração ${String(health.database.migrationVersion)} · ${String(health.database.latencyMs)} ms`}
            label="Banco de dados"
            status="ready"
          />
          {health.components.map((component) => (
            <HealthRow
              detail={component.stale ? "sem heartbeat recente" : undefined}
              key={component.componentId}
              label={componentLabels[component.componentType] ?? component.componentId}
              status={component.status}
            />
          ))}
          <HealthRow
            detail={`${formatInteger(health.queue.scheduled)} na fila · ${formatInteger(health.queue.failed)} falhas`}
            label="Fila durável de processamento"
            status={health.queue.failed > 0 ? "degraded" : "ready"}
          />
        </div>
      )}
    </Card>
  );
}

function HealthRow({
  detail,
  label,
  status,
}: {
  detail?: string | undefined;
  label: string;
  status: "ready" | "degraded" | "unavailable" | "not_configured";
}) {
  const icons = {
    degraded: <CircleAlert className="size-3.5 shrink-0 text-warn" />,
    not_configured: <CircleAlert className="size-3.5 shrink-0 text-ink-dim" />,
    ready: <CircleCheck className="size-3.5 shrink-0 text-ok" />,
    unavailable: <CircleX className="size-3.5 shrink-0 text-fail" />,
  };
  return (
    <div className="flex items-center gap-2 text-[12.5px]">
      {icons[status]}
      <span className="min-w-0 flex-1 truncate text-ink-secondary">{label}</span>
      {detail !== undefined && <span className="label-mono shrink-0 text-ink-dim">{detail}</span>}
    </div>
  );
}
