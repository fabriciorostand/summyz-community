import {
  Check,
  CircleAlert,
  CircleCheck,
  CircleX,
  Cloud,
  Copy,
  GlobeLock,
  Info,
  KeyRound,
  Monitor,
  Terminal,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";

import {
  Button,
  Card,
  DiscordIcon,
  Field,
  FormError,
  Label,
  Notice,
  SectionHeading,
} from "../components/ui";
import { useDashboard } from "../layout/dashboard-layout";
import { TopBar } from "../layout/top-bar";
import { type AccessMode, ApiError, api, type InstallationHealth } from "../lib/api";
import { formatInteger } from "../lib/format";
import { Screen } from "./screen";

const minimumPasswordLength = 15;

/** Every block saves on its own; there is no page-wide form. */
export function InstallationPage() {
  const { patchSettings, reloadSettings, settings } = useDashboard();

  // The shared snapshot may predate a save made on this screen, so the server decides.
  useEffect(() => {
    void reloadSettings();
  }, [reloadSettings]);

  return (
    <>
      <TopBar
        actions={<AccessModeChip accessMode={settings.accessMode} />}
        meta="Cada bloco salva separadamente"
        title="Instalação"
      />
      <Screen>
        <div className="grid items-start gap-4 xl:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-4">
            <DiscordApplicationCard
              applicationId={settings.discordApplicationId}
              onReplaced={reloadSettings}
              tokenConfigured={settings.secrets.discordBotToken}
            />
            <ProvidersCard
              configured={settings.secrets.openRouterApiKey}
              onChange={(openRouterApiKey) => {
                // The write succeeded, so reflect it right away and let the reload confirm it.
                patchSettings({ secrets: { ...settings.secrets, openRouterApiKey } });
                void reloadSettings();
              }}
            />
            {settings.accessMode === "public" && <PasswordCard />}
          </div>
          <div className="flex min-w-0 flex-col gap-4">
            <AccessCard accessMode={settings.accessMode} />
            <HealthCard />
          </div>
        </div>
      </Screen>
    </>
  );
}

function AccessModeChip({ accessMode }: { accessMode: AccessMode }) {
  return (
    <span className="label-mono inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1.5 text-ink-secondary">
      {accessMode === "public" ? <Cloud className="size-3" /> : <Monitor className="size-3" />}
      {accessMode === "public" ? "Modo público" : "Modo local"}
    </span>
  );
}

function DiscordApplicationCard({
  applicationId,
  onReplaced,
  tokenConfigured,
}: {
  applicationId: string | null;
  /** The server derives a new Application ID from the token, so the caller refreshes it. */
  onReplaced: () => Promise<void>;
  tokenConfigured: boolean;
}) {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<"replaced" | "invalid" | "failed">();

  async function replace() {
    if (token === "") return;
    setBusy(true);
    setOutcome(undefined);
    try {
      await api.replaceBotToken(token);
      setToken("");
      setOutcome("replaced");
      await onReplaced();
    } catch (caught) {
      setOutcome(
        caught instanceof ApiError && caught.code === "invalid_discord_bot_token"
          ? "invalid"
          : "failed",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <SectionHeading icon={<DiscordIcon className="size-4" />} title="Aplicação Discord" />
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label>Application ID</Label>
          <ApplicationId value={applicationId} />
          <small className="text-[11px] text-ink-dim">
            Somente leitura. O backend descobre o ID pelo próprio token do bot, então ele nunca fica
            divergente.
          </small>
        </div>
        <div className="flex items-end gap-2">
          <Field
            autoComplete="off"
            className="flex-1"
            label="Token do bot"
            onChange={(event) => {
              setToken(event.currentTarget.value);
              setOutcome(undefined);
            }}
            placeholder={
              tokenConfigured ? "Configurado — digite para substituir" : "Ainda não configurado"
            }
            type="password"
            value={token}
          />
          <Button
            disabled={busy || token === ""}
            onClick={() => void replace()}
            type="button"
            variant="secondary"
          >
            {busy ? "Validando…" : "Substituir"}
          </Button>
        </div>
        {outcome === "replaced" && (
          <p className="m-0 flex items-center gap-1.5 text-[12.5px] text-ok">
            <Check className="size-3.5" />
            Token substituído. Reinicie o processo do bot para aplicar.
          </p>
        )}
        {outcome === "invalid" && <FormError>Token recusado pelo Discord.</FormError>}
        {outcome === "failed" && <FormError>Não foi possível substituir o token.</FormError>}
        <Notice icon={<TriangleAlert className="mt-0.5 size-3.5 shrink-0" />} tone="warn">
          Substituir o token revalida a aplicação e reescreve o Application ID. O processo do bot
          precisa ser reiniciado depois da troca, e os servidores visíveis passam a ser os do bot
          novo.
        </Notice>
        <Notice icon={<Info className="mt-0.5 size-3.5 shrink-0" />}>
          Não existe client secret: o Community não usa OAuth de usuário. Domínio e URL pública
          ficam no <InlineCode>.env</InlineCode>.
        </Notice>
      </div>
    </Card>
  );
}

function ApplicationId({ value }: { value: string | null }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1_600);
    return () => clearTimeout(timer);
  }, [copied]);
  if (value === null) {
    return (
      <span className="rounded-lg border border-line bg-surface-raised px-3 py-2 font-mono text-[12.5px] text-ink-dim">
        Ainda não configurado
      </span>
    );
  }
  return (
    <div className="flex items-center gap-2 rounded-lg border border-line bg-surface-raised px-3 py-2">
      <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-ink">{value}</span>
      <button
        aria-label="Copiar Application ID"
        className="grid size-6 place-items-center rounded text-ink-dim transition-colors hover:bg-surface-inset hover:text-ink"
        onClick={() => {
          void navigator.clipboard.writeText(value).then(
            () => setCopied(true),
            () => setCopied(false),
          );
        }}
        type="button"
      >
        {copied ? <Check className="size-3.5 text-ok" /> : <Copy className="size-3.5" />}
      </button>
    </div>
  );
}

function ProvidersCard({
  configured,
  onChange,
}: {
  configured: boolean;
  onChange: (configured: boolean) => void;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function run(action: () => Promise<void>, nextConfigured: boolean) {
    setBusy(true);
    setFailed(false);
    try {
      await action();
      setValue("");
      onChange(nextConfigured);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <SectionHeading icon={<KeyRound className="size-4" />} title="Provedores" />
      <div className="flex flex-col gap-3">
        <div className="flex items-end gap-2">
          <Field
            autoComplete="off"
            className="flex-1"
            label="Chave OpenRouter"
            onChange={(event) => setValue(event.currentTarget.value)}
            placeholder={
              configured ? "Configurado — digite para substituir" : "Ainda não configurado"
            }
            type="password"
            value={value}
          />
          <Button
            disabled={busy || value === ""}
            onClick={() => void run(() => api.updateSecret("openrouter_api_key", value), true)}
            type="button"
            variant="secondary"
          >
            Atualizar
          </Button>
          <Button
            aria-label="Remover chave OpenRouter"
            className="px-2.5"
            disabled={busy || !configured}
            onClick={() => void run(() => api.removeSecret("openrouter_api_key"), false)}
            type="button"
            variant="ghost"
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
        {failed && <FormError>Não foi possível salvar a chave. Tente novamente.</FormError>}
      </div>
    </Card>
  );
}

/** Public mode only: local installations have no password, so the block is not rendered. */
function PasswordCard() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [done, setDone] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setDone(false);
    setError(undefined);
    const length = [...newPassword].length;
    if (length < minimumPasswordLength || length > 128) {
      setError("A nova senha precisa ter de 15 a 128 caracteres.");
      return;
    }
    setBusy(true);
    try {
      await api.changePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
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

  return (
    <Card>
      <SectionHeading
        action={<span className="label-mono shrink-0 text-ink-dim">Só modo público</span>}
        icon={<KeyRound className="size-4" />}
        title="Senha da instalação"
      />
      <form className="flex flex-col gap-3" onSubmit={(event) => void submit(event)}>
        <Field
          autoComplete="current-password"
          label="Senha atual"
          onChange={(event) => setCurrentPassword(event.currentTarget.value)}
          type="password"
          value={currentPassword}
        />
        <Field
          autoComplete="new-password"
          hint="De 15 a 128 caracteres. Sem exigência de maiúsculas, números ou símbolos — só o comprimento importa. Senhas comuns são recusadas."
          label="Nova senha"
          maxLength={128}
          onChange={(event) => setNewPassword(event.currentTarget.value)}
          type="password"
          value={newPassword}
        />
        {error !== undefined && <FormError>{error}</FormError>}
        {done && (
          <p className="m-0 flex items-center gap-1.5 text-[12.5px] text-ok">
            <Check className="size-3.5" />
            Senha trocada. As outras sessões foram encerradas.
          </p>
        )}
        <Button
          className="self-start"
          disabled={busy || currentPassword === "" || newPassword === ""}
          type="submit"
          variant="secondary"
        >
          {busy ? "Trocando…" : "Trocar senha"}
        </Button>
      </form>
      <div className="mt-4">
        <Notice icon={<Terminal className="mt-0.5 size-3.5 shrink-0" />}>
          Perdeu a senha? Rode <InlineCode accent>recover-access</InlineCode> no host: ele imprime
          uma URL de uso único, válida por 10 minutos. A senha antiga só deixa de valer quando a
          nova é gravada.
        </Notice>
      </div>
    </Card>
  );
}

function AccessCard({ accessMode }: { accessMode: AccessMode }) {
  return (
    <Card aria-labelledby="access-title" role="region">
      <SectionHeading
        icon={<GlobeLock className="size-4" />}
        id="access-title"
        title="Acesso ao dashboard"
      />
      <p className="m-0 mb-4 text-[12.5px] leading-relaxed text-ink-muted">
        Definido pelo script usado para subir a instalação. O dashboard mostra o estado, mas não
        altera a infraestrutura.
      </p>
      <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
        <AccessModeRow
          active={accessMode === "local"}
          description={<span className="label-mono">127.0.0.1:8787</span>}
          icon={<Monitor className="size-4" />}
          title="Modo local"
        />
        <AccessModeRow
          active={accessMode === "public"}
          description="Caddy com HTTPS automático, para quem hospeda em VPS."
          icon={<Cloud className="size-4" />}
          title="Modo público"
        />
      </ul>
      <div className="mt-3.5">
        <Notice icon={<Terminal className="mt-0.5 size-3.5 shrink-0" />}>
          Para publicar: defina o domínio no <InlineCode>.env</InlineCode>, e suba com{" "}
          <InlineCode accent>summyz-community-public</InlineCode>.
        </Notice>
      </div>
    </Card>
  );
}

function AccessModeRow({
  active,
  description,
  icon,
  title,
}: {
  active: boolean;
  description: ReactNode;
  icon: ReactNode;
  title: string;
}) {
  return (
    <li
      aria-label={title}
      className={`flex items-center gap-3 rounded-[10px] border px-4 py-3.5 ${
        active ? "border-action/50 bg-action-soft" : "border-line bg-surface-raised"
      }`}
    >
      <span
        className={`grid size-[30px] shrink-0 place-items-center rounded-lg ${
          active ? "bg-action text-white" : "bg-surface-inset text-ink-muted"
        }`}
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <strong className="block text-[13px] font-medium text-ink">{title}</strong>
        <small className="mt-1 block text-[12px] leading-relaxed text-ink-muted">
          {description}
        </small>
      </div>
      {active && (
        <span className="label-mono shrink-0 rounded-md bg-action-soft px-2 py-1 text-accent-hover">
          Ativo
        </span>
      )}
    </li>
  );
}

function InlineCode({ accent = false, children }: { accent?: boolean; children: string }) {
  return <code className={`font-mono ${accent ? "text-accent-hover" : ""}`}>{children}</code>;
}

const componentLabels: Record<string, string> = {
  bot: "Bot autenticado no Discord",
  database: "Banco de dados conectado",
  faster_whisper: "faster-whisper",
  ffmpeg: "FFmpeg com libopus",
  ollama: "Ollama",
  openrouter: "OpenRouter",
  queue: "Fila durável de processamento",
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
      <h2 className="m-0 mb-3 text-[14px] font-semibold tracking-tight text-ink" id="health-title">
        Estado da instalação
      </h2>
      <section aria-labelledby="health-title">
        {failed ? (
          <p className="m-0 text-[12.5px] text-ink-muted">
            Não foi possível consultar o estado dos componentes.
          </p>
        ) : health === undefined ? (
          <p className="m-0 text-[12.5px] text-ink-muted">Consultando componentes…</p>
        ) : (
          <div className="flex flex-col gap-2.5">
            <HealthRow label="Banco de dados conectado" status="ready" />
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
      </section>
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
    degraded: <CircleAlert className="size-[15px] shrink-0 text-warn" />,
    not_configured: <CircleAlert className="size-[15px] shrink-0 text-ink-dim" />,
    ready: <CircleCheck className="size-[15px] shrink-0 text-ok" />,
    unavailable: <CircleX className="size-[15px] shrink-0 text-fail" />,
  };
  return (
    <div className="flex items-center gap-2.5 text-[12.5px]">
      {icons[status]}
      <span className="min-w-0 flex-1 truncate text-ink">{label}</span>
      {detail !== undefined && (
        <span className="shrink-0 font-mono text-[10.5px] text-ink-muted">{detail}</span>
      )}
    </div>
  );
}
