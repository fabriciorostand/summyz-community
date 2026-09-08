import {
  ArrowLeft,
  ArrowUpRight,
  Bot,
  Check,
  CircleAlert,
  CircleCheck,
  Database,
  Languages,
  Megaphone,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { Disclosure } from "../components/disclosure";
import { ErrorState, LoadingPanel } from "../components/states";
import {
  Badge,
  Card,
  Notice,
  RailLabel,
  SectionHeading,
  SelectField,
  Toggle,
} from "../components/ui";
import { useDashboard } from "../layout/dashboard-layout";
import { TopBar } from "../layout/top-bar";
import { api, type GuildConfiguration, type GuildResources } from "../lib/api";
import { formatCost, formatInteger } from "../lib/format";
import { Screen } from "./screen";

export function GuildPage() {
  const { guildId = "" } = useParams();
  const { dashboard, guilds } = useDashboard();
  const [configuration, setConfiguration] = useState<GuildConfiguration>();
  const [resources, setResources] = useState<GuildResources>();
  const [loadError, setLoadError] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setLoadError(false);
    setConfiguration(undefined);
    setResources(undefined);
    try {
      const [nextConfiguration, nextResources] = await Promise.all([
        api.getGuildConfiguration(guildId),
        api.getGuildResources(guildId),
      ]);
      setConfiguration(nextConfiguration);
      setResources(nextResources);
    } catch {
      setLoadError(true);
    }
  }, [guildId]);

  useEffect(() => {
    void load();
  }, [load]);

  const flashSaved = useCallback(() => {
    setSaved(true);
    setTimeout(() => setSaved(false), 1_800);
  }, []);

  const guild = guilds.guilds?.find((item) => item.id === guildId);
  return (
    <>
      <TopBar
        actions={
          saved ? (
            <span className="flex items-center gap-1.5 text-[12.5px] text-ok">
              <Check className="size-3.5" />
              Alterações salvas
            </span>
          ) : undefined
        }
        breadcrumb={
          <Link
            className="flex items-center gap-1.5 text-[13px] text-ink-muted hover:text-ink"
            to="/servers"
          >
            <ArrowLeft className="size-3.5" />
            Servidores
          </Link>
        }
        title={guild?.name ?? "Configuração do servidor"}
      />
      <Screen>
        {loadError ? (
          <ErrorState
            code="request_failed"
            onRetry={() => void load()}
            title="Configuração indisponível"
          >
            Não foi possível concluir as consultas necessárias para este servidor.
          </ErrorState>
        ) : configuration === undefined || resources === undefined ? (
          <LoadingPanel label="Carregando configuração…" />
        ) : (
          <GuildBody
            configuration={configuration}
            dashboard={dashboard}
            guildId={guildId}
            onChange={setConfiguration}
            onSaved={flashSaved}
            resources={resources}
          />
        )}
      </Screen>
    </>
  );
}

function GuildBody({
  configuration,
  dashboard,
  guildId,
  onChange,
  onSaved,
  resources,
}: {
  configuration: GuildConfiguration;
  dashboard: ReturnType<typeof useDashboard>["dashboard"];
  guildId: string;
  onChange: (value: GuildConfiguration) => void;
  onSaved: () => void;
  resources: GuildResources;
}) {
  async function activateProfile(profileId: string) {
    if (profileId === "") return;
    await api.setActiveProfile(guildId, profileId);
    onChange({ ...configuration, activeProfileId: profileId });
    onSaved();
  }

  async function saveSettings(settings: GuildConfiguration["settings"]) {
    await api.updateGuildSettings(guildId, settings);
    onChange({ ...configuration, settings });
    onSaved();
  }

  async function toggleRole(roleId: string, checked: boolean) {
    const roleIds = checked
      ? [...configuration.recordingRoleIds, roleId]
      : configuration.recordingRoleIds.filter((current) => current !== roleId);
    await api.updateRecordingPermissions(guildId, {
      roleIds,
      userIds: [...configuration.recordingUserIds],
    });
    onChange({ ...configuration, recordingRoleIds: roleIds });
    onSaved();
  }

  async function updateForum(forumId: string) {
    if (forumId === "") {
      const { summaryForum: _dropped, ...withoutForum } = configuration;
      await api.updateForum(guildId, null);
      onChange(withoutForum);
    } else {
      await api.updateForum(guildId, { forumId });
      onChange({ ...configuration, summaryForum: { forumId } });
    }
    onSaved();
  }

  async function updateTag(tagId: string) {
    if (configuration.summaryForum === undefined) return;
    const next =
      tagId === ""
        ? { forumId: configuration.summaryForum.forumId }
        : { forumId: configuration.summaryForum.forumId, tagId };
    await api.updateForum(guildId, next);
    onChange({ ...configuration, summaryForum: next });
    onSaved();
  }

  const forum = resources.forums.find((item) => item.id === configuration.summaryForum?.forumId);
  const memberCountsUnavailable = resources.memberCounts?.status === "unavailable";

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
      <div className="flex min-w-0 flex-col gap-4">
        <RailLabel>O essencial</RailLabel>
        <Card>
          <SectionHeading
            action={
              <Link
                className="flex shrink-0 items-center gap-1 text-[12.5px] text-accent hover:text-accent-hover"
                to="/profiles"
              >
                Gerenciar perfis
                <ArrowUpRight className="size-3.5" />
              </Link>
            }
            description="Define os modelos de transcrição, refino e resumo das próximas reuniões."
            icon={<Bot className="size-4" />}
            title="Perfil de IA usado neste servidor"
          />
          <div className="flex flex-col gap-2">
            {configuration.profiles.map((profile) => {
              const active = profile.profileId === configuration.activeProfileId;
              return (
                <label
                  className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3.5 py-3 transition-colors ${
                    active ? "border-action bg-action-soft" : "border-line bg-surface-raised"
                  }`}
                  key={profile.profileId}
                >
                  <input
                    checked={active}
                    className="size-4 shrink-0 accent-action"
                    name="active-profile"
                    onChange={() => void activateProfile(profile.profileId)}
                    type="radio"
                  />
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <strong className="truncate text-[13px] font-medium text-ink">
                      {profile.name}
                    </strong>
                    <small className="label-mono text-ink-muted">
                      {profile.profileType === "external" ? "API externa" : "Local"} ·{" "}
                      {profile.transcription.model ?? "modelo padrão"} ·{" "}
                      {profile.summary.model ?? "modelo padrão"} · {profile.language}
                    </small>
                  </span>
                  {active && <Badge tone="action">Em uso</Badge>}
                </label>
              );
            })}
          </div>
        </Card>

        <Card>
          <SectionHeading
            description="Cada call concluída gera um post no fórum escolhido."
            icon={<Megaphone className="size-4" />}
            title="Onde publicar os resumos"
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField
              label="Canal de fórum"
              onChange={(event) => void updateForum(event.currentTarget.value)}
              value={configuration.summaryForum?.forumId ?? ""}
            >
              <option value="">Não configurado</option>
              {resources.forums.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </SelectField>
            <SelectField
              disabled={forum === undefined}
              label="Tag padrão"
              onChange={(event) => void updateTag(event.currentTarget.value)}
              value={configuration.summaryForum?.tagId ?? ""}
            >
              <option value="">Sem tag</option>
              {forum?.tags.map((tag) => (
                <option key={tag.id} value={tag.id}>
                  {tag.name}
                </option>
              ))}
            </SelectField>
          </div>
        </Card>

        <Card>
          <SectionHeading
            description="Donos e administradores do servidor sempre podem. Adicione cargos extras."
            icon={<ShieldCheck className="size-4" />}
            title="Quem pode iniciar uma gravação"
          />
          <div className="flex flex-col gap-1.5">
            {resources.roles.map((role) => (
              <label
                className="flex cursor-pointer items-center gap-3 rounded-lg border border-line bg-surface-raised px-3.5 py-2.5"
                key={role.id}
              >
                <span className="size-1.5 shrink-0 rounded-full bg-accent" />
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{role.name}</span>
                {role.memberCount != null && (
                  <span className="label-mono shrink-0 text-ink-dim">
                    {formatInteger(role.memberCount)} membros
                  </span>
                )}
                <input
                  checked={configuration.recordingRoleIds.includes(role.id)}
                  className="size-4 shrink-0 accent-action"
                  onChange={(event) => void toggleRole(role.id, event.currentTarget.checked)}
                  type="checkbox"
                />
              </label>
            ))}
          </div>
          {memberCountsUnavailable && (
            <div className="mt-3">
              <Notice icon={<TriangleAlert className="mt-0.5 size-3.5 shrink-0" />} tone="warn">
                A contagem de membros exige a intent de membros habilitada na aplicação do Discord.
              </Notice>
            </div>
          )}
        </Card>

        <div className="mt-2">
          <RailLabel>Avançado</RailLabel>
        </div>
        <Disclosure
          icon={<Database className="size-4" />}
          summary={`Conteúdo ${configuration.settings.persistMeetingContent ? "retido" : "descartado"} · áudio ${configuration.settings.persistMeetingAudio ? "retido" : "descartado"}`}
          title="Privacidade e retenção"
        >
          <div className="flex flex-col gap-3">
            <Toggle
              checked={configuration.settings.persistMeetingContent}
              description="Mantém o conteúdo no banco após a publicação. Sem isso, o histórico só guarda metadados."
              label="Reter transcrição e resumo"
              onChange={(persistMeetingContent) =>
                void saveSettings({ ...configuration.settings, persistMeetingContent })
              }
            />
            <Toggle
              checked={configuration.settings.persistMeetingAudio}
              description="Desativado por padrão. Os arquivos ficam em DATA_DIR por tempo indeterminado e só saem por remoção manual."
              label="Reter áudio bruto"
              onChange={(persistMeetingAudio) =>
                void saveSettings({ ...configuration.settings, persistMeetingAudio })
              }
            />
            <Notice icon={<TriangleAlert className="mt-0.5 size-3.5 shrink-0" />} tone="warn">
              Conteúdo e áudio preservados não expiram automaticamente. A exclusão é uma operação
              manual do administrador.
            </Notice>
          </div>
        </Disclosure>
        <Disclosure
          icon={<Languages className="size-4" />}
          summary={
            configuration.settings.botLanguage === "pt-BR" ? "Português (Brasil)" : "English"
          }
          title="Idioma do bot"
        >
          <SelectField
            label="Idioma do bot"
            onChange={(event) =>
              void saveSettings({
                ...configuration.settings,
                botLanguage: event.currentTarget.value === "pt-BR" ? "pt-BR" : "en",
              })
            }
            value={configuration.settings.botLanguage}
          >
            <option value="pt-BR">Português (Brasil)</option>
            <option value="en">English</option>
          </SelectField>
        </Disclosure>
      </div>

      <div className="flex flex-col gap-4">
        <Card>
          <h2 className="m-0 text-[15px] font-semibold tracking-tight text-ink">
            Este servidor em números
          </h2>
          <p className="m-0 mt-1 mb-3 text-[11.5px] text-ink-muted">
            Período selecionado na visão geral.
          </p>
          {dashboard === undefined ? (
            <p className="m-0 text-[12.5px] text-ink-muted">Métricas indisponíveis.</p>
          ) : (
            <div className="flex flex-col">
              <Stat label="Calls concluídas" value={formatInteger(dashboard.totalCalls)} />
              <Stat
                label="Falhas no pipeline"
                value={formatInteger(
                  dashboard.statusSeries.reduce((total, bucket) => total + bucket.failed, 0),
                )}
              />
              <Stat
                label="Horas gravadas"
                value={formatInteger(dashboard.totalDurationMs / 3_600_000, 1)}
              />
              <Stat label="Custo confirmado" value={formatCost(dashboard.cost.confirmed)} />
            </div>
          )}
        </Card>
        <Card>
          <h2 className="m-0 mb-3 text-[15px] font-semibold tracking-tight text-ink">
            Checklist da instalação
          </h2>
          <div className="flex flex-col gap-2">
            <CheckItem done label="Bot presente no servidor" />
            <CheckItem
              done={configuration.summaryForum !== undefined}
              label="Fórum de resumos definido"
            />
            <CheckItem done={configuration.activeProfileId !== null} label="Perfil de IA ativo" />
            <CheckItem
              done={configuration.recordingRoleIds.length > 0}
              label="Cargo extra autorizado"
            />
          </div>
        </Card>
        <Card>
          <h2 className="m-0 text-[15px] font-semibold tracking-tight text-ink">
            Comandos rápidos
          </h2>
          <p className="m-0 mt-1 mb-3 text-[11.5px] text-ink-muted">
            O mesmo que o dashboard faz, direto no Discord.
          </p>
          <div className="flex flex-wrap gap-2">
            {["/record start", "/record status"].map((command) => (
              <code
                className="rounded bg-surface-inset px-2 py-1 font-mono text-[11px] text-ink-secondary"
                key={command}
              >
                {command}
              </code>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line-soft py-2 last:border-0">
      <span className="text-[12px] text-ink-muted">{label}</span>
      <span className="font-mono text-[12px] text-ink-secondary">{value}</span>
    </div>
  );
}

function CheckItem({ done, label }: { done: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2 text-[12.5px]">
      {done ? (
        <CircleCheck className="size-3.5 shrink-0 text-ok" />
      ) : (
        <CircleAlert className="size-3.5 shrink-0 text-warn" />
      )}
      <span className={done ? "text-ink-secondary" : "text-ink-muted"}>{label}</span>
    </div>
  );
}
