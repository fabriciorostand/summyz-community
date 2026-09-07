import { Bot, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { api, type GuildConfiguration, type GuildResources } from "./api";
import { Button, EmptyState, Loading, SelectField, Toggle } from "./components";

import { flashSaved, Page, SectionTitle } from "./dashboard-shared";

export function GuildConfigurationPage() {
  const { guildId = "" } = useParams();
  const [configuration, setConfiguration] = useState<GuildConfiguration>();
  const [resources, setResources] = useState<GuildResources>();
  const [saved, setSaved] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const loadConfiguration = useCallback(async () => {
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
    void loadConfiguration();
  }, [loadConfiguration]);
  if (loadError) {
    return (
      <Page
        title="Não foi possível carregar a configuração"
        eyebrow="Servidor Discord"
        description="Não foi possível concluir as consultas necessárias. Tente novamente."
      >
        <EmptyState title="Configuração indisponível">
          <Button onClick={() => void loadConfiguration()} type="button">
            Tentar novamente
          </Button>
        </EmptyState>
      </Page>
    );
  }
  if (configuration === undefined || resources === undefined) return <Loading />;
  const currentConfiguration = configuration;
  const currentResources = resources;
  async function saveSettings(next: GuildConfiguration["settings"]) {
    await api.updateGuildSettings(guildId, next);
    setConfiguration({ ...currentConfiguration, settings: next });
    flashSaved(setSaved);
  }
  return (
    <Page
      title="Configuração do servidor"
      eyebrow="Servidor Discord"
      description="Cada alteração afeta somente este servidor."
    >
      {saved && <span className="save-toast">Alterações salvas</span>}
      <div className="configuration-grid">
        <div className="config-column">
          <SectionTitle
            icon={<SlidersHorizontal />}
            title="Comportamento"
            description="Idioma e retenção usados no início de cada nova reunião."
          />
          <section className="panel stack">
            <SelectField
              label="Idioma do bot"
              value={currentConfiguration.settings.botLanguage}
              onChange={(event) =>
                void saveSettings({
                  ...currentConfiguration.settings,
                  botLanguage: event.currentTarget.value === "pt-BR" ? "pt-BR" : "en",
                })
              }
            >
              <option value="pt-BR">Português (Brasil)</option>
              <option value="en">English</option>
            </SelectField>
            <Toggle
              checked={currentConfiguration.settings.persistMeetingContent}
              label="Reter conteúdo"
              description="Mantém transcrição e resumo após a publicação. Ativado por padrão."
              onChange={(checked) =>
                void saveSettings({
                  ...currentConfiguration.settings,
                  persistMeetingContent: checked,
                })
              }
            />
            <Toggle
              checked={currentConfiguration.settings.persistMeetingAudio}
              label="Reter áudio"
              description="Mantém os segmentos de áudio após o processamento. Desativado por padrão."
              onChange={(checked) =>
                void saveSettings({
                  ...currentConfiguration.settings,
                  persistMeetingAudio: checked,
                })
              }
            />
          </section>
          <AccessPanel
            configuration={currentConfiguration}
            guildId={guildId}
            resources={currentResources}
            onUpdate={setConfiguration}
          />
          <ForumPanel
            configuration={currentConfiguration}
            guildId={guildId}
            resources={currentResources}
            onUpdate={setConfiguration}
          />
        </div>
        <div className="config-column wide">
          <ActiveProfilePanel
            configuration={currentConfiguration}
            guildId={guildId}
            onUpdate={setConfiguration}
          />
        </div>
      </div>
    </Page>
  );
}

function AccessPanel({
  configuration,
  guildId,
  onUpdate,
  resources,
}: {
  configuration: GuildConfiguration;
  guildId: string;
  onUpdate: (value: GuildConfiguration) => void;
  resources: GuildResources;
}) {
  async function toggleRole(roleId: string, checked: boolean) {
    const roleIds = checked
      ? [...configuration.recordingRoleIds, roleId]
      : configuration.recordingRoleIds.filter((current) => current !== roleId);
    await api.updateRoles(guildId, roleIds);
    onUpdate({ ...configuration, recordingRoleIds: roleIds });
  }
  return (
    <>
      <SectionTitle
        icon={<ShieldCheck />}
        title="Quem pode gravar"
        description="Administradores e donos continuam autorizados; adicione cargos extras."
      />
      <section className="panel option-list">
        {resources.roles.map((role) => (
          <label key={role.id}>
            <span className="role-dot" />
            {role.name}
            <input
              checked={configuration.recordingRoleIds.includes(role.id)}
              onChange={(event) => void toggleRole(role.id, event.currentTarget.checked)}
              type="checkbox"
            />
          </label>
        ))}
      </section>
    </>
  );
}

function ForumPanel({
  configuration,
  guildId,
  onUpdate,
  resources,
}: {
  configuration: GuildConfiguration;
  guildId: string;
  onUpdate: (value: GuildConfiguration) => void;
  resources: GuildResources;
}) {
  const forum = resources.forums.find((item) => item.id === configuration.summaryForum?.forumId);
  async function updateForum(forumId: string) {
    if (forumId === "") {
      const { summaryForum: _summaryForum, ...withoutForum } = configuration;
      await api.updateForum(guildId, null);
      onUpdate(withoutForum);
      return;
    }
    await api.updateForum(guildId, { forumId });
    onUpdate({ ...configuration, summaryForum: { forumId } });
  }
  async function updateTag(tagId: string) {
    if (configuration.summaryForum === undefined) return;
    const next =
      tagId === ""
        ? { forumId: configuration.summaryForum.forumId }
        : { forumId: configuration.summaryForum.forumId, tagId };
    await api.updateForum(guildId, next);
    onUpdate({ ...configuration, summaryForum: next });
  }
  return (
    <>
      <SectionTitle
        icon={<Bot />}
        title="Publicação"
        description="Destino dos resumos concluídos."
      />
      <section className="panel form-grid">
        <SelectField
          label="Canal de fórum"
          value={configuration.summaryForum?.forumId ?? ""}
          onChange={(event) => void updateForum(event.currentTarget.value)}
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
          value={configuration.summaryForum?.tagId ?? ""}
          onChange={(event) => void updateTag(event.currentTarget.value)}
        >
          <option value="">Sem tag</option>
          {forum?.tags.map((tag) => (
            <option key={tag.id} value={tag.id}>
              {tag.name}
            </option>
          ))}
        </SelectField>
      </section>
    </>
  );
}

function ActiveProfilePanel({
  configuration,
  guildId,
  onUpdate,
}: {
  configuration: GuildConfiguration;
  guildId: string;
  onUpdate: (value: GuildConfiguration) => void;
}) {
  async function activate(profileId: string) {
    if (profileId === "") return;
    await api.setActiveProfile(guildId, profileId);
    onUpdate({ ...configuration, activeProfileId: profileId });
  }
  const externalProfiles = configuration.profiles.filter(
    (profile) => profile.profileType === "external",
  );
  const localProfiles = configuration.profiles.filter((profile) => profile.profileType === "local");
  return (
    <>
      <SectionTitle
        icon={<Bot />}
        title="Perfil ativo"
        description="Escolha a configuração usada nas próximas reuniões deste servidor."
      />
      <section className="panel stack">
        <SelectField
          label="Perfil de processamento"
          value={configuration.activeProfileId ?? ""}
          onChange={(event) => void activate(event.currentTarget.value)}
        >
          <option value="">Selecione um perfil</option>
          <optgroup label="API externa">
            {externalProfiles.map((profile) => (
              <option key={profile.profileId} value={profile.profileId}>
                {profile.name} — {profile.transcription.provider}
              </option>
            ))}
          </optgroup>
          <optgroup label="Local">
            {localProfiles.map((profile) => (
              <option key={profile.profileId} value={profile.profileId}>
                {profile.name} — {profile.transcription.provider}
              </option>
            ))}
          </optgroup>
        </SelectField>
        <p className="field-hint">
          Os perfis são pessoais e reutilizáveis. <Link to="/profiles">Gerenciar perfis</Link>
        </p>
      </section>
    </>
  );
}
