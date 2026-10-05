import {
  Check,
  CircleAlert,
  CircleCheck,
  CircleX,
  Cloud,
  GlobeLock,
  KeyRound,
  Monitor,
  Terminal,
} from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useId, useState } from "react";

import { SecretField } from "../components/secret-field";
import { Button, Card, Field, FormError, Notice, SectionHeading } from "../components/ui";
import type { Messages } from "../i18n/messages/pt-BR";
import { useI18n } from "../i18n/store";
import { useDashboard } from "../layout/dashboard-layout";
import { TopBar } from "../layout/top-bar";
import { type AccessMode, ApiError, api, type InstallationHealth } from "../lib/api";
import { Screen } from "./screen";

const minimumPasswordLength = 15;

/** Every block saves on its own; there is no page-wide form. */
export function InstallationPage() {
  const { patchSettings, reloadSettings, settings } = useDashboard();
  const { t } = useI18n();

  // The shared snapshot may predate a save made on this screen, so the server decides.
  useEffect(() => {
    void reloadSettings();
  }, [reloadSettings]);

  return (
    <>
      <TopBar title={t.installation.title} />
      <Screen>
        <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-4">
            <ProvidersCard
              configured={settings.secrets.openRouterApiKey}
              // The write succeeded, so reflect it right away and let the reload confirm it.
              onChange={(configured) => {
                patchSettings({ secrets: { ...settings.secrets, openRouterApiKey: configured } });
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

function ProvidersCard({
  configured,
  onChange,
}: {
  configured: boolean;
  onChange: (configured: boolean) => void;
}) {
  const { t } = useI18n();
  const titleId = useId();
  return (
    <Card aria-labelledby={titleId} role="region">
      <SectionHeading
        icon={<KeyRound className="size-4" />}
        id={titleId}
        title={t.installation.providers}
      />
      <SecretField
        configured={configured}
        editLabel={t.installation.editKey}
        failedMessage={t.installation.keyFailed}
        label={t.installation.openRouterKey}
        name="openrouter_api_key"
        onChange={onChange}
        removeLabel={t.installation.removeKey}
      />
    </Card>
  );
}

/** Public mode only: local installations have no password, so the block is not rendered. */
function PasswordCard() {
  const { t } = useI18n();
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
      setError(t.installation.passwordLength);
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
          ? t.installation.passwordMismatch
          : t.installation.passwordFailed,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <SectionHeading
        action={
          <span className="label-mono shrink-0 text-ink-dim">{t.installation.publicOnly}</span>
        }
        icon={<KeyRound className="size-4" />}
        title={t.installation.installationPassword}
      />
      <form className="flex flex-col gap-3" onSubmit={(event) => void submit(event)}>
        <Field
          autoComplete="current-password"
          label={t.installation.currentPassword}
          onChange={(event) => setCurrentPassword(event.currentTarget.value)}
          type="password"
          value={currentPassword}
        />
        <Field
          autoComplete="new-password"
          hint={t.installation.newPasswordHint}
          label={t.installation.newPassword}
          maxLength={128}
          onChange={(event) => setNewPassword(event.currentTarget.value)}
          type="password"
          value={newPassword}
        />
        {error !== undefined && <FormError>{error}</FormError>}
        {done && (
          <p className="m-0 flex items-center gap-1.5 text-[12.5px] text-ok">
            <Check className="size-3.5" />
            {t.installation.passwordChanged}
          </p>
        )}
        <Button
          className="self-start"
          disabled={busy || currentPassword === "" || newPassword === ""}
          type="submit"
          variant="secondary"
        >
          {busy ? t.installation.changing : t.installation.changePassword}
        </Button>
      </form>
      <div className="mt-4">
        <Notice icon={<Terminal className="mt-0.5 size-3.5 shrink-0" />}>
          {t.installation.recoverBefore} <InlineCode accent>recover-access</InlineCode>{" "}
          {t.installation.recoverAfter}
        </Notice>
      </div>
    </Card>
  );
}

function AccessCard({ accessMode }: { accessMode: AccessMode }) {
  const { t } = useI18n();
  return (
    <Card aria-labelledby="access-title" role="region">
      <SectionHeading
        icon={<GlobeLock className="size-4" />}
        id="access-title"
        title={t.installation.access}
      />
      <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
        <AccessModeRow
          active={accessMode === "local"}
          description={<span className="label-mono">127.0.0.1:8787</span>}
          icon={<Monitor className="size-4" />}
          title={t.installation.localMode}
        />
        <AccessModeRow
          active={accessMode === "public"}
          description={t.installation.publicModeDescription}
          icon={<Cloud className="size-4" />}
          title={t.installation.publicMode}
        />
      </ul>
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
  const { t } = useI18n();
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
          {t.installation.active}
        </span>
      )}
    </li>
  );
}

function InlineCode({ accent = false, children }: { accent?: boolean; children: string }) {
  return <code className={`font-mono ${accent ? "text-accent-hover" : ""}`}>{children}</code>;
}

function componentLabel(component: InstallationHealth["components"][number], t: Messages): string {
  return t.installation.components[component.componentType];
}

function HealthCard() {
  const { format, t } = useI18n();
  const [health, setHealth] = useState<InstallationHealth>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    void api.getInstallationHealth().then(setHealth, () => setFailed(true));
  }, []);

  return (
    <Card>
      <h2 className="m-0 mb-3 text-[14px] font-semibold tracking-tight text-ink" id="health-title">
        {t.installation.health}
      </h2>
      <section aria-labelledby="health-title">
        {failed ? (
          <p className="m-0 text-[12.5px] text-ink-muted">{t.installation.healthFailed}</p>
        ) : health === undefined ? (
          <p className="m-0 text-[12.5px] text-ink-muted">{t.installation.healthLoading}</p>
        ) : (
          <div className="flex flex-col gap-2.5">
            <HealthRow label={t.installation.components.database} status="ready" />
            {health.components.map((component) => (
              <HealthRow
                detail={component.stale ? t.installation.stale : undefined}
                key={component.componentId}
                label={componentLabel(component, t)}
                status={component.status}
              />
            ))}
            <HealthRow
              detail={t.installation.queueDetail(
                format.number(health.queue.scheduled),
                format.number(health.queue.failed),
              )}
              label={t.installation.components.queue}
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
