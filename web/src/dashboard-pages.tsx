import {
  Bot,
  Cable,
  ChevronRight,
  CircleHelp,
  Command,
  ExternalLink,
  LayoutDashboard,
  LogOut,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  UserRound,
} from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, NavLink, Outlet, useNavigate, useOutletContext, useParams } from "react-router-dom";
import { z } from "zod";

import {
  api,
  type DiscordConnection,
  type Guild,
  type GuildConfiguration,
  type GuildResources,
  type InstallationSettings,
  type Profile,
  type PromptDefaults,
  type User,
} from "./api";
import {
  Brand,
  Button,
  EmptyState,
  Field,
  Loading,
  SelectField,
  TextAreaField,
  Toggle,
} from "./components";

export function DashboardLayout({ user }: { user: User }) {
  const navigate = useNavigate();
  async function logout() {
    await api.logout();
    navigate("/login");
  }
  return (
    <div className="dashboard-shell">
      <aside className="sidebar">
        <Brand />
        <nav>
          <NavItem icon={<LayoutDashboard />} label="Servidores" to="/" />
          <NavItem icon={<Command />} label="Comandos" to="/commands" />
          <NavItem icon={<UserRound />} label="Minha conta" to="/account" />
          {user.installationRole === "administrator" && (
            <NavItem icon={<Settings />} label="Instalação" to="/installation" />
          )}
        </nav>
        <div className="sidebar-user">
          <span className="avatar">{user.email.slice(0, 1).toUpperCase()}</span>
          <span>
            <strong>{user.email}</strong>
            <small>{user.installationRole === "administrator" ? "Administrador" : "Membro"}</small>
          </span>
          <button aria-label="Sair" onClick={logout} type="button">
            <LogOut />
          </button>
        </div>
      </aside>
      <main className="dashboard-main">
        <Outlet context={user} />
      </main>
    </div>
  );
}

function NavItem({ icon, label, to }: { icon: ReactNode; label: string; to: string }) {
  return (
    <NavLink className={({ isActive }) => (isActive ? "active" : "")} end={to === "/"} to={to}>
      {icon}
      <span>{label}</span>
    </NavLink>
  );
}

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
      description="Escolha onde você quer configurar o Summyz. Só aparecem servidores dos quais sua conta Discord é proprietária."
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
            <h2>Conta Summyz</h2>
            <p>{user.email}</p>
          </div>
          <span className="status good">
            <ShieldCheck /> E-mail verificado
          </span>
        </div>
      </section>
      <section className="panel">
        <div className="panel-title">
          <div className="round-icon discord">
            <Cable />
          </div>
          <div>
            <h2>Discord</h2>
            <p>
              {connection?.connected === true
                ? `Conectado como ${connection.discordUsername}.`
                : "Conecte para encontrar servidores dos quais você é dono."}
            </p>
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
        {connection?.connected === true ? (
          <Button className="secondary" disabled={busy} onClick={disconnect}>
            {busy ? "Desconectando…" : "Desconectar Discord"}
          </Button>
        ) : connection !== undefined ? (
          <Button disabled={busy} onClick={connect}>
            {busy ? "Abrindo Discord…" : "Conectar ao Discord"}
          </Button>
        ) : null}
      </section>
    </Page>
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

export function GuildConfigurationPage() {
  const { guildId = "" } = useParams();
  const [configuration, setConfiguration] = useState<GuildConfiguration>();
  const [resources, setResources] = useState<GuildResources>();
  const [selectedProfileId, setSelectedProfileId] = useState<string>();
  const [saved, setSaved] = useState(false);
  const [loadError, setLoadError] = useState(false);
  useEffect(() => {
    void Promise.all([api.getGuildConfiguration(guildId), api.getGuildResources(guildId)])
      .then(([nextConfiguration, nextResources]) => {
        setConfiguration(nextConfiguration);
        setResources(nextResources);
        setSelectedProfileId(nextConfiguration.activeProfileId);
      })
      .catch(() => setLoadError(true));
  }, [guildId]);
  if (loadError) {
    return (
      <Page
        title="Não foi possível carregar a configuração"
        eyebrow="Servidor Discord"
        description="O Discord ou o banco de dados recusou uma das consultas. Volte e tente novamente."
      >
        <EmptyState title="Configuração indisponível">
          <Link to="/">Voltar aos servidores</Link>
        </EmptyState>
      </Page>
    );
  }
  if (configuration === undefined || resources === undefined) return <Loading />;
  const currentConfiguration = configuration;
  const currentResources = resources;
  const selected =
    currentConfiguration.profiles.find((profile) => profile.profileId === selectedProfileId) ??
    currentConfiguration.profiles[0];
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
          <ProfilePanel
            configuration={currentConfiguration}
            guildId={guildId}
            selected={selected ?? null}
            selectedProfileId={selectedProfileId ?? null}
            onSelect={(profileId) => setSelectedProfileId(profileId)}
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

function ProfilePanel({
  configuration,
  guildId,
  onSelect,
  onUpdate,
  selected,
  selectedProfileId,
}: {
  configuration: GuildConfiguration;
  guildId: string;
  onSelect: (id: string) => void;
  onUpdate: (value: GuildConfiguration) => void;
  selected: Profile | null;
  selectedProfileId: string | null;
}) {
  const [draft, setDraft] = useState<Profile | null>(selected);
  const [promptDefaults, setPromptDefaults] = useState<PromptDefaults>();
  const previousPromptDefaults = useRef<PromptDefaults | undefined>(undefined);
  const promptProfileId = draft?.profileId;
  const promptSummaryLanguage = draft?.summary.language;
  useEffect(() => {
    previousPromptDefaults.current = undefined;
    setPromptDefaults(undefined);
    setDraft(selected);
  }, [selected]);
  useEffect(() => {
    if (promptProfileId === undefined || promptSummaryLanguage === undefined) return;
    const profileId = promptProfileId;
    const summaryLanguage = promptSummaryLanguage;
    const previous = previousPromptDefaults.current;
    let active = true;
    void api.getPromptDefaults(summaryLanguage).then((next) => {
      if (!active) return;
      setDraft((current) => {
        if (
          current === null ||
          current.profileId !== profileId ||
          current.summary.language !== summaryLanguage ||
          previous === undefined
        ) {
          return current;
        }
        return {
          ...current,
          summary: {
            ...current.summary,
            consolidationPrompt:
              current.summary.consolidationPrompt === previous.summaryConsolidation
                ? next.summaryConsolidation
                : current.summary.consolidationPrompt,
            extractionPrompt:
              current.summary.extractionPrompt === previous.summaryExtraction
                ? next.summaryExtraction
                : current.summary.extractionPrompt,
          },
        };
      });
      previousPromptDefaults.current = next;
      setPromptDefaults(next);
    });
    return () => {
      active = false;
    };
  }, [promptProfileId, promptSummaryLanguage]);
  if (draft === null) return null;
  const currentDraft = draft;
  async function save(event: FormEvent) {
    event.preventDefault();
    await api.updateProfile(guildId, currentDraft);
    onUpdate({
      ...configuration,
      profiles: configuration.profiles.map((profile) =>
        profile.profileId === currentDraft.profileId ? currentDraft : profile,
      ),
    });
  }
  async function create() {
    const { guildId: _guildId, profileId: _profileId, ...base } = currentDraft;
    const created = await api.createProfile(guildId, {
      ...base,
      name: `Perfil ${configuration.profiles.length + 1}`,
    });
    onUpdate({ ...configuration, profiles: [...configuration.profiles, created] });
    onSelect(created.profileId);
  }
  async function activate() {
    await api.setActiveProfile(guildId, currentDraft.profileId);
    onUpdate({ ...configuration, activeProfileId: currentDraft.profileId });
  }
  async function remove() {
    const replacement = configuration.profiles.find(
      (profile) => profile.profileId !== currentDraft.profileId,
    );
    await api.deleteProfile(guildId, currentDraft.profileId, replacement?.profileId);
    const profiles = configuration.profiles.filter(
      (profile) => profile.profileId !== currentDraft.profileId,
    );
    onUpdate({
      ...configuration,
      activeProfileId:
        configuration.activeProfileId === currentDraft.profileId && replacement !== undefined
          ? replacement.profileId
          : configuration.activeProfileId,
      profiles,
    });
    onSelect(profiles[0]?.profileId ?? "");
  }
  return (
    <>
      <div className="section-title profile-heading">
        <span>
          <Bot />
        </span>
        <div>
          <h2>Perfis de IA</h2>
          <p>Modelos locais e OpenRouter podem coexistir em perfis nomeados.</p>
        </div>
        <Button className="secondary" onClick={create}>
          Novo perfil
        </Button>
      </div>
      <div className="profile-tabs">
        {configuration.profiles.map((profile) => (
          <button
            className={profile.profileId === selectedProfileId ? "active" : ""}
            key={profile.profileId}
            onClick={() => onSelect(profile.profileId)}
            type="button"
          >
            {profile.name}
            {configuration.activeProfileId === profile.profileId && <i>Ativo</i>}
          </button>
        ))}
      </div>
      <form className="panel stack" onSubmit={save}>
        <div className="profile-actions">
          <Field
            label="Nome do perfil"
            value={currentDraft.name}
            onChange={(event) => setDraft({ ...currentDraft, name: event.currentTarget.value })}
          />
          <Button
            className="secondary"
            disabled={configuration.activeProfileId === currentDraft.profileId}
            onClick={activate}
            type="button"
          >
            Tornar ativo
          </Button>
        </div>
        <PhaseEditor
          phase="Transcrição"
          profile={currentDraft}
          promptDefaults={promptDefaults}
          onChange={setDraft}
        />
        <PhaseEditor
          phase="Refinamento"
          profile={currentDraft}
          promptDefaults={promptDefaults}
          onChange={setDraft}
        />
        <PhaseEditor
          phase="Resumo"
          profile={currentDraft}
          promptDefaults={promptDefaults}
          onChange={setDraft}
        />
        <div className="form-actions">
          <Button type="submit">Salvar perfil</Button>
          <Button
            className="danger"
            disabled={configuration.profiles.length === 1}
            onClick={remove}
            type="button"
          >
            Excluir perfil
          </Button>
        </div>
      </form>
    </>
  );
}

function PhaseEditor({
  onChange,
  phase,
  profile,
  promptDefaults,
}: {
  onChange: (profile: Profile) => void;
  phase: "Transcrição" | "Refinamento" | "Resumo";
  profile: Profile;
  promptDefaults: PromptDefaults | undefined;
}) {
  if (phase === "Transcrição") {
    const value = profile.transcription;
    return (
      <fieldset className="phase">
        <legend>{phase}</legend>
        <div className="form-grid">
          <SelectField
            label="Provedor"
            value={value.provider ?? ""}
            onChange={(event) =>
              onChange({
                ...profile,
                transcription: {
                  ...value,
                  provider:
                    event.currentTarget.value === "faster-whisper"
                      ? "faster-whisper"
                      : event.currentTarget.value === "openrouter"
                        ? "openrouter"
                        : null,
                },
              })
            }
          >
            <option value="">Escolha um provedor</option>
            <option value="faster-whisper">faster-whisper</option>
            <option value="openrouter">openrouter</option>
          </SelectField>
          <Field
            label="Modelo"
            placeholder="medium ou vendor/model"
            value={value.model ?? ""}
            onChange={(event) =>
              onChange({
                ...profile,
                transcription: { ...value, model: event.currentTarget.value || null },
              })
            }
          />
        </div>
        <Field
          label="Idioma"
          value={value.language}
          onChange={(event) =>
            onChange({
              ...profile,
              transcription: { ...value, language: event.currentTarget.value },
            })
          }
        />
        <div className="form-grid">
          <Field
            label="Tamanho do lote"
            placeholder="auto ou 0–64"
            value={value.batchSize}
            onChange={(event) => {
              const raw = event.currentTarget.value;
              onChange({
                ...profile,
                transcription: {
                  ...value,
                  batchSize: raw === "auto" || raw === "" ? "auto" : Number(raw),
                },
              });
            }}
          />
          <Field
            label="Intervalo máximo de união (ms)"
            min={0}
            type="number"
            value={value.mergeMaxGapMs}
            onChange={(event) =>
              onChange({
                ...profile,
                transcription: { ...value, mergeMaxGapMs: event.currentTarget.valueAsNumber },
              })
            }
          />
        </div>
        <div className="form-grid">
          <SelectField
            label="Timestamps"
            value={value.timestampMode}
            onChange={(event) =>
              onChange({
                ...profile,
                transcription: {
                  ...value,
                  timestampMode: event.currentTarget.value === "batch" ? "batch" : "word",
                },
              })
            }
          >
            <option value="word">Por palavra</option>
            <option value="batch">Por lote</option>
          </SelectField>
          <Field
            label="Silêncio entre falas (ms)"
            min={0}
            type="number"
            value={value.interSpeechSilenceMs}
            onChange={(event) =>
              onChange({
                ...profile,
                transcription: {
                  ...value,
                  interSpeechSilenceMs: event.currentTarget.valueAsNumber,
                },
              })
            }
          />
          <Field
            label="Temperatura"
            max={1}
            min={0}
            step={0.1}
            type="number"
            value={value.temperature ?? ""}
            onChange={(event) => {
              const { temperature: _temperature, ...withoutTemperature } = value;
              onChange({
                ...profile,
                transcription:
                  event.currentTarget.value === ""
                    ? withoutTemperature
                    : { ...value, temperature: event.currentTarget.valueAsNumber },
              });
            }}
          />
        </div>
        <PromptEditor
          defaultPrompt={promptDefaults?.transcription ?? null}
          disabledMessage="Nenhum prompt será enviado na transcrição."
          label="Prompt da transcrição"
          toggleLabel="Enviar prompt de transcrição"
          value={value.prompt}
          onChange={(prompt) => onChange({ ...profile, transcription: { ...value, prompt } })}
        />
        <TextAreaField
          defaultValue={JSON.stringify(value.providerOptions ?? {}, null, 2)}
          hint="Objeto JSON agrupado pelo slug do provedor."
          label="Opções avançadas do provedor"
          rows={4}
          onBlur={(event) => {
            const parsed = parseProviderOptions(event.currentTarget.value);
            if (parsed !== undefined)
              onChange({ ...profile, transcription: { ...value, providerOptions: parsed } });
          }}
        />
      </fieldset>
    );
  }
  const key = phase === "Refinamento" ? "refinement" : "summary";
  const value = profile[key];
  function replace(next: typeof value) {
    onChange(
      key === "refinement"
        ? { ...profile, refinement: next }
        : { ...profile, summary: { ...profile.summary, ...next } },
    );
  }
  return (
    <fieldset className="phase">
      <legend>{phase}</legend>
      <div className="form-grid">
        <SelectField
          label="Provedor"
          value={value.provider ?? ""}
          onChange={(event) =>
            replace({
              ...value,
              provider:
                event.currentTarget.value === "ollama"
                  ? "ollama"
                  : event.currentTarget.value === "openrouter"
                    ? "openrouter"
                    : null,
            })
          }
        >
          <option value="">Escolha um provedor</option>
          <option value="ollama">ollama</option>
          <option value="openrouter">openrouter</option>
        </SelectField>
        <Field
          label="Modelo"
          placeholder="qwen3:4b ou vendor/model"
          value={value.model ?? ""}
          onChange={(event) => replace({ ...value, model: event.currentTarget.value || null })}
        />
      </div>
      {phase === "Resumo" && (
        <Field
          label="Idioma"
          value={profile.summary.language}
          onChange={(event) =>
            onChange({
              ...profile,
              summary: { ...profile.summary, language: event.currentTarget.value },
            })
          }
        />
      )}
      <div className="form-grid">
        <Field
          label="Máximo por trecho"
          min={1000}
          type="number"
          value={value.maxChunkCharacters}
          onChange={(event) =>
            replace({ ...value, maxChunkCharacters: event.currentTarget.valueAsNumber })
          }
        />
        <Field
          label="Temperatura"
          max={2}
          min={0}
          step={0.1}
          type="number"
          value={value.generation.temperature ?? ""}
          onChange={(event) =>
            replace({
              ...value,
              generation:
                event.currentTarget.value === ""
                  ? { ...value.generation, temperature: undefined }
                  : { ...value.generation, temperature: event.currentTarget.valueAsNumber },
            })
          }
        />
      </div>
      <div className="form-grid">
        <Field
          label="Seed"
          type="number"
          value={value.generation.seed ?? ""}
          onChange={(event) => {
            const { seed: _seed, ...withoutSeed } = value.generation;
            replace({
              ...value,
              generation:
                event.currentTarget.value === ""
                  ? withoutSeed
                  : { ...value.generation, seed: event.currentTarget.valueAsNumber },
            });
          }}
        />
        <Toggle
          checked={value.generation.think ?? false}
          label="Raciocínio do modelo"
          description="Encaminha think=true quando o provedor oferece suporte."
          onChange={(think) => replace({ ...value, generation: { ...value.generation, think } })}
        />
      </div>
      {phase === "Refinamento" ? (
        <PromptEditor
          defaultPrompt={promptDefaults?.refinement}
          disabledMessage="Nenhum prompt será enviado no refinamento."
          label="Prompt de refinamento"
          toggleLabel="Enviar prompt de refinamento"
          value={profile.refinement.prompt}
          onChange={(prompt) =>
            onChange({ ...profile, refinement: { ...profile.refinement, prompt } })
          }
        />
      ) : (
        <div className="summary-prompts">
          <PromptEditor
            defaultPrompt={promptDefaults?.summaryExtraction}
            disabledMessage="Nenhum prompt será enviado na extração do resumo."
            label="Prompt do resumo — extração"
            toggleLabel="Enviar prompt de extração"
            value={profile.summary.extractionPrompt}
            onChange={(extractionPrompt) =>
              onChange({
                ...profile,
                summary: { ...profile.summary, extractionPrompt },
              })
            }
          />
          <PromptEditor
            defaultPrompt={promptDefaults?.summaryConsolidation}
            disabledMessage="Nenhum prompt será enviado na consolidação do resumo."
            label="Prompt do resumo — consolidação"
            toggleLabel="Enviar prompt de consolidação"
            value={profile.summary.consolidationPrompt}
            onChange={(consolidationPrompt) =>
              onChange({
                ...profile,
                summary: { ...profile.summary, consolidationPrompt },
              })
            }
          />
        </div>
      )}
    </fieldset>
  );
}

function PromptEditor({
  defaultPrompt,
  disabledMessage,
  label,
  onChange,
  toggleLabel,
  value,
}: {
  defaultPrompt: string | null | undefined;
  disabledMessage: string;
  label: string;
  onChange: (value: string | null) => void;
  toggleLabel: string;
  value: string | null | undefined;
}) {
  const [pendingAction, setPendingAction] = useState<"disable" | "restore" | null>(null);
  const enabled = value !== null && value !== undefined;

  function confirmPendingAction() {
    if (pendingAction === "disable") onChange(null);
    if (pendingAction === "restore" && defaultPrompt !== undefined && defaultPrompt !== null) {
      onChange(defaultPrompt);
    }
    setPendingAction(null);
  }

  return (
    <section className="prompt-editor">
      <Toggle
        checked={enabled}
        description="Desative para enviar esta fase sem prompt."
        label={toggleLabel}
        onChange={(checked) => {
          if (checked) onChange(defaultPrompt ?? "");
          else setPendingAction("disable");
        }}
      />
      {enabled ? (
        <>
          <TextAreaField
            hint="O texto completo será enviado ao modelo. Limite de 20.000 caracteres."
            label={label}
            maxLength={20_000}
            required
            rows={7}
            value={value}
            onChange={(event) => onChange(event.currentTarget.value)}
          />
          {defaultPrompt !== undefined && defaultPrompt !== null && value !== defaultPrompt && (
            <Button
              className="secondary prompt-reset"
              onClick={() => setPendingAction("restore")}
              type="button"
            >
              Restaurar padrão
            </Button>
          )}
        </>
      ) : (
        <div className="prompt-disabled">
          <strong>Sem prompt</strong>
          <span>{disabledMessage}</span>
          {defaultPrompt !== undefined && defaultPrompt !== null && (
            <Button className="secondary" onClick={() => onChange(defaultPrompt)} type="button">
              Usar prompt padrão
            </Button>
          )}
        </div>
      )}
      {pendingAction !== null && (
        <div
          aria-label={pendingAction === "disable" ? "Desativar prompt" : "Restaurar prompt"}
          className="prompt-confirm"
          role="alertdialog"
        >
          <strong>
            {pendingAction === "disable" ? "Desativar este prompt?" : "Restaurar o padrão?"}
          </strong>
          <span>
            {pendingAction === "disable"
              ? "O texto atual será removido do perfil e esta fase será enviada ao modelo sem prompt."
              : "A personalização atual será substituída pelo prompt padrão."}
          </span>
          <div className="prompt-confirm-actions">
            <Button className="secondary" onClick={() => setPendingAction(null)} type="button">
              Cancelar
            </Button>
            <Button
              className={pendingAction === "disable" ? "danger" : undefined}
              onClick={confirmPendingAction}
              type="button"
            >
              {pendingAction === "disable" ? "Desativar prompt" : "Restaurar prompt"}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

const providerOptionsSchema = z.record(z.string().min(1), z.record(z.string().min(1), z.json()));

function parseProviderOptions(input: string) {
  try {
    const value: unknown = JSON.parse(input);
    const parsed = providerOptionsSchema.safeParse(value);
    return parsed.success ? parsed.data : undefined;
  } catch (_error) {
    return undefined;
  }
}

export function InstallationPage() {
  const [settings, setSettings] = useState<InstallationSettings>();
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    void api.getInstallationSettings().then(setSettings);
  }, []);
  if (settings === undefined) return <Loading />;
  const currentSettings = settings;
  const smtp = currentSettings.smtp ?? {
    fromEmail: "",
    fromName: "Summyz",
    host: "smtp-relay.brevo.com",
    port: 587,
    replyTo: null,
    secure: false,
    user: "",
  };
  async function save(event: FormEvent) {
    event.preventDefault();
    const { secrets: _secrets, setupCompleted: _setupCompleted, ...value } = currentSettings;
    await api.updateInstallationSettings(value);
    flashSaved(setSaved);
  }
  return (
    <Page
      title="Instalação"
      eyebrow="Administração"
      description="Credenciais globais, SMTP e disponibilidade do cadastro."
    >
      {saved && <span className="save-toast">Alterações salvas</span>}
      <form className="installation-grid" onSubmit={save}>
        <section className="panel stack">
          <h2>Discord</h2>
          <Field
            label="Client ID"
            value={currentSettings.discordClientId ?? ""}
            onChange={(event) =>
              setSettings({
                ...currentSettings,
                discordClientId: event.currentTarget.value || null,
              })
            }
          />
          <SecretField
            configured={currentSettings.secrets.discordBotToken}
            label="Token do bot"
            name="discord_bot_token"
          />
          <SecretField
            configured={currentSettings.secrets.discordClientSecret}
            label="Client secret"
            name="discord_client_secret"
          />
          <Field
            label="URL pública"
            type="url"
            value={currentSettings.publicBaseUrl ?? ""}
            onChange={(event) =>
              setSettings({ ...currentSettings, publicBaseUrl: event.currentTarget.value || null })
            }
          />
        </section>
        <section className="panel stack">
          <h2>Provedores</h2>
          <SecretField
            configured={currentSettings.secrets.openRouterApiKey}
            label="Chave OpenRouter"
            name="openrouter_api_key"
          />
          <h2>E-mail SMTP</h2>
          <p className="muted">
            Compatível com Brevo e outros provedores SMTP. O plano gratuito recomendado é o Brevo.
          </p>
          <Toggle
            checked={currentSettings.smtp !== null}
            label="Envio de e-mail ativo"
            description="Necessário para verificar cadastros e redefinir senhas."
            onChange={(enabled) => setSettings({ ...currentSettings, smtp: enabled ? smtp : null })}
          />
          <div className="form-grid">
            <Field
              label="Servidor SMTP"
              value={smtp.host}
              onChange={(event) =>
                setSettings({
                  ...currentSettings,
                  smtp: { ...smtp, host: event.currentTarget.value },
                })
              }
            />
            <Field
              label="Porta"
              min={1}
              type="number"
              value={smtp.port}
              onChange={(event) =>
                setSettings({
                  ...currentSettings,
                  smtp: { ...smtp, port: event.currentTarget.valueAsNumber },
                })
              }
            />
          </div>
          <Field
            label="Login SMTP"
            value={smtp.user}
            onChange={(event) =>
              setSettings({
                ...currentSettings,
                smtp: { ...smtp, user: event.currentTarget.value },
              })
            }
          />
          <div className="form-grid">
            <Field
              label="E-mail remetente"
              type="email"
              value={smtp.fromEmail}
              onChange={(event) =>
                setSettings({
                  ...currentSettings,
                  smtp: { ...smtp, fromEmail: event.currentTarget.value },
                })
              }
            />
            <Field
              label="Nome do remetente"
              value={smtp.fromName}
              onChange={(event) =>
                setSettings({
                  ...currentSettings,
                  smtp: { ...smtp, fromName: event.currentTarget.value },
                })
              }
            />
          </div>
          <Toggle
            checked={smtp.secure}
            label="TLS implícito"
            description="Use com a porta 465. Na porta 587, mantenha desativado para STARTTLS."
            onChange={(secure) => setSettings({ ...currentSettings, smtp: { ...smtp, secure } })}
          />
          <SecretField
            configured={currentSettings.secrets.smtpPassword}
            label="Senha SMTP"
            name="smtp_password"
          />
        </section>
        <section className="panel stack">
          <h2>Acesso</h2>
          <Toggle
            checked={currentSettings.registrationEnabled}
            label="Cadastro público"
            description="Qualquer pessoa pode criar conta; servidores continuam limitados aos proprietários."
            onChange={(registrationEnabled) =>
              setSettings({ ...currentSettings, registrationEnabled })
            }
          />
          <Button type="submit">Salvar instalação</Button>
        </section>
      </form>
    </Page>
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
  async function save() {
    if (value === "") return;
    await api.updateSecret(name, value);
    setValue("");
  }
  return (
    <div className="secret-field">
      <Field
        label={label}
        onChange={(event) => setValue(event.currentTarget.value)}
        placeholder={configured ? "Configurado — digite para substituir" : "Ainda não configurado"}
        type="password"
        value={value}
      />
      <Button className="secondary" onClick={save} type="button">
        Atualizar
      </Button>
    </div>
  );
}

function Page({
  children,
  description,
  eyebrow,
  title,
}: {
  children: ReactNode;
  description: string;
  eyebrow: string;
  title: string;
}) {
  return (
    <div className="page">
      <header className="page-header">
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{description}</p>
      </header>
      {children}
    </div>
  );
}

function SectionTitle({
  description,
  icon,
  title,
}: {
  description: string;
  icon: ReactNode;
  title: string;
}) {
  return (
    <div className="section-title">
      <span>{icon}</span>
      <div>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
    </div>
  );
}

function flashSaved(setSaved: (value: boolean) => void) {
  setSaved(true);
  window.setTimeout(() => setSaved(false), 1800);
}
