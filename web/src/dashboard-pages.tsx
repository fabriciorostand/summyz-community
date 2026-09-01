import {
  Bot,
  CalendarDays,
  Cable,
  ChevronRight,
  CircleHelp,
  Command,
  ExternalLink,
  LayoutDashboard,
  History as HistoryIcon,
  LogOut,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Clock3,
  Mic2,
  Server,
  Users,
  WalletCards,
  UserRound,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, NavLink, Outlet, useNavigate, useOutletContext, useParams } from "react-router-dom";
import { z } from "zod";

import {
  api,
  profileSchema,
  type DiscordConnection,
  type Guild,
  type GuildConfiguration,
  type GuildResources,
  type DashboardAnalytics,
  type InstallationSettings,
  type MeetingHistoryDetail,
  type MeetingHistoryPage as MeetingHistoryPageData,
  type MeetingHistorySummary,
  type Profile,
  type ProfileListItem,
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
          <NavItem icon={<LayoutDashboard />} label="Dashboard" to="/" />
          <NavItem icon={<HistoryIcon />} label="Histórico" to="/history" />
          <NavItem icon={<Server />} label="Servidores" to="/servers" />
          <NavItem icon={<Bot />} label="Perfis" to="/profiles" />
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

const selectedGuildStorageKey = "summyz:selected-guild";

function useServerSelection(): {
  error: boolean;
  guilds: Guild[] | undefined;
  selectedGuildId: string;
  setSelectedGuildId(value: string): void;
} {
  const [guilds, setGuilds] = useState<Guild[]>();
  const [error, setError] = useState(false);
  const [selectedGuildId, setSelectedGuildIdState] = useState("");
  useEffect(() => {
    let active = true;
    void api
      .listGuilds()
      .then((allGuilds) => {
        if (!active) return;
        const installed = allGuilds.filter((guild) => guild.installed);
        const stored = localStorage.getItem(selectedGuildStorageKey);
        const selected = installed.some((guild) => guild.id === stored)
          ? (stored ?? "")
          : (installed[0]?.id ?? "");
        setGuilds(installed);
        setSelectedGuildIdState(selected);
        if (selected.length > 0) localStorage.setItem(selectedGuildStorageKey, selected);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, []);
  return {
    error,
    guilds,
    selectedGuildId,
    setSelectedGuildId(value) {
      localStorage.setItem(selectedGuildStorageKey, value);
      setSelectedGuildIdState(value);
    },
  };
}

function ServerSelector({
  guilds,
  onChange,
  value,
}: {
  guilds: readonly Guild[];
  onChange(value: string): void;
  value: string;
}) {
  return (
    <div className="server-selector">
      <SelectField
        label="Servidor"
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
      >
        {guilds.map((guild) => (
          <option key={guild.id} value={guild.id}>
            {guild.name}
          </option>
        ))}
      </SelectField>
    </div>
  );
}

export function AnalyticsDashboardPage() {
  const selection = useServerSelection();
  const [dashboard, setDashboard] = useState<DashboardAnalytics>();
  const [loadError, setLoadError] = useState(false);
  useEffect(() => {
    if (selection.selectedGuildId.length === 0) return;
    setDashboard(undefined);
    setLoadError(false);
    void api
      .getDashboard(selection.selectedGuildId)
      .then(setDashboard)
      .catch(() => setLoadError(true));
  }, [selection.selectedGuildId]);
  return (
    <Page
      title="Dashboard"
      eyebrow="Visão histórica"
      description="Os números consideram apenas calls com o pipeline totalmente concluído."
    >
      {selection.guilds !== undefined && selection.guilds.length > 0 && (
        <ServerSelector
          guilds={selection.guilds}
          onChange={selection.setSelectedGuildId}
          value={selection.selectedGuildId}
        />
      )}
      {selection.error || loadError ? (
        <EmptyState title="Dashboard indisponível">
          Não foi possível carregar as métricas.
        </EmptyState>
      ) : selection.guilds === undefined ||
        (selection.selectedGuildId.length > 0 && dashboard === undefined) ? (
        <Loading />
      ) : selection.guilds.length === 0 ? (
        <EmptyState title="Nenhum servidor instalado">
          Instale o Summyz em um servidor para acompanhar suas calls.
        </EmptyState>
      ) : dashboard === undefined ? null : (
        <>
          <div className="metric-grid">
            <MetricCard
              icon={<CalendarDays />}
              label="Total de calls"
              value={String(dashboard.totalCalls)}
            />
            <MetricCard
              icon={<Clock3 />}
              label="Duração total"
              value={formatDuration(dashboard.totalDurationMs)}
            />
            <MetricCard
              icon={<Users />}
              label="Duração média"
              value={formatDuration(dashboard.averageDurationMs)}
            />
            <MetricCard
              icon={<WalletCards />}
              label="Custo confirmado"
              {...(dashboard.hasUnresolvedCosts
                ? { note: "Há custos pendentes ou não atribuídos." }
                : {})}
              value={formatCosts(dashboard.confirmedCost)}
            />
          </div>
          <section className="panel speaker-panel">
            <div className="analytics-section-heading">
              <div>
                <span className="eyebrow">Todo o período</span>
                <h2>Top speakers</h2>
              </div>
              <Mic2 />
            </div>
            {dashboard.topSpeakers.length === 0 ? (
              <p className="muted">
                O talk time estará disponível após a primeira call nova concluída.
              </p>
            ) : (
              <div className="speaker-list">
                {dashboard.topSpeakers.map((speaker, index) => {
                  const maximum = dashboard.topSpeakers[0]?.talkTimeMs ?? 1;
                  return (
                    <div className="speaker-row" key={speaker.userId}>
                      <div>
                        <strong>{speaker.displayName}</strong>
                        <span>{formatDuration(speaker.talkTimeMs)}</span>
                      </div>
                      <span
                        className={`speaker-bar tone-${String(index + 1)}`}
                        style={{ width: `${Math.max(4, (speaker.talkTimeMs / maximum) * 100)}%` }}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </section>
          <p className="timezone-note">Datas e filtros usam o fuso {dashboard.timeZone}.</p>
        </>
      )}
    </Page>
  );
}

function MetricCard({
  icon,
  label,
  note,
  value,
}: {
  icon: ReactNode;
  label: string;
  note?: string;
  value: string;
}) {
  return (
    <article className="metric-card">
      <span>{icon}</span>
      <small>{label}</small>
      <strong>{value}</strong>
      {note !== undefined && <em>{note}</em>}
    </article>
  );
}

export function MeetingHistoryPage() {
  const selection = useServerSelection();
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [state, setState] = useState("");
  const [meetingIdInput, setMeetingIdInput] = useState("");
  const [meetingIdSearch, setMeetingIdSearch] = useState("");
  const [page, setPage] = useState(1);
  const [history, setHistory] = useState<MeetingHistoryPageData>();
  const [loadError, setLoadError] = useState(false);
  useEffect(() => {
    if (selection.selectedGuildId.length === 0) return;
    setHistory(undefined);
    setLoadError(false);
    void api
      .listMeetings(selection.selectedGuildId, {
        page,
        ...(meetingIdSearch.length > 0
          ? { meetingId: meetingIdSearch }
          : {
              ...(dateFrom.length === 0 ? {} : { dateFrom }),
              ...(dateTo.length === 0 ? {} : { dateTo }),
              ...(state.length === 0 ? {} : { state }),
            }),
      })
      .then(setHistory)
      .catch(() => setLoadError(true));
  }, [dateFrom, dateTo, meetingIdSearch, page, selection.selectedGuildId, state]);
  return (
    <Page
      title="Histórico de calls"
      eyebrow="Reuniões"
      description="Consulte o andamento, os participantes e os conteúdos retidos de cada call."
    >
      {selection.guilds !== undefined && selection.guilds.length > 0 && (
        <ServerSelector
          guilds={selection.guilds}
          onChange={(value) => {
            setPage(1);
            selection.setSelectedGuildId(value);
          }}
          value={selection.selectedGuildId}
        />
      )}
      {selection.guilds !== undefined && selection.guilds.length > 0 && (
        <form
          className="meeting-id-search panel"
          onSubmit={(event) => {
            event.preventDefault();
            const meetingId = meetingIdInput.trim();
            if (meetingId.length === 0) return;
            setPage(1);
            setMeetingIdSearch(meetingId);
          }}
        >
          <Field
            label="ID da reunião"
            maxLength={128}
            value={meetingIdInput}
            onChange={(event) => setMeetingIdInput(event.currentTarget.value)}
          />
          <div className="meeting-id-search-actions">
            <Button disabled={meetingIdInput.trim().length === 0} type="submit">
              Pesquisar
            </Button>
            {meetingIdSearch.length > 0 && (
              <Button
                className="secondary"
                onClick={() => {
                  setMeetingIdInput("");
                  setMeetingIdSearch("");
                  setPage(1);
                }}
                type="button"
              >
                Limpar
              </Button>
            )}
          </div>
        </form>
      )}
      {selection.guilds !== undefined && selection.guilds.length > 0 && (
        <div className="history-filters panel">
          <Field
            disabled={meetingIdSearch.length > 0}
            label="De"
            type="date"
            value={dateFrom}
            onChange={(event) => {
              setPage(1);
              setDateFrom(event.currentTarget.value);
            }}
          />
          <Field
            disabled={meetingIdSearch.length > 0}
            label="Até"
            type="date"
            value={dateTo}
            onChange={(event) => {
              setPage(1);
              setDateTo(event.currentTarget.value);
            }}
          />
          <SelectField
            disabled={meetingIdSearch.length > 0}
            label="Estado"
            value={state}
            onChange={(event) => {
              setPage(1);
              setState(event.currentTarget.value);
            }}
          >
            <option value="">Todos</option>
            <option value="in_progress">Em andamento</option>
            <option value="completed">Concluída</option>
            <option value="failed">Falhou</option>
          </SelectField>
        </div>
      )}
      {selection.error || loadError ? (
        <EmptyState title="Histórico indisponível">Não foi possível carregar as calls.</EmptyState>
      ) : selection.guilds === undefined ||
        (selection.selectedGuildId.length > 0 && history === undefined) ? (
        <Loading />
      ) : selection.guilds.length === 0 ? (
        <EmptyState title="Nenhum servidor instalado">
          Instale o Summyz para começar o histórico.
        </EmptyState>
      ) : history === undefined || history.items.length === 0 ? (
        <EmptyState title="Nenhuma call encontrada">
          Ajuste os filtros ou aguarde a primeira reunião.
        </EmptyState>
      ) : (
        <>
          <div className="history-list">
            {history.items.map((meeting) => (
              <article className="history-card" key={meeting.meetingId}>
                <div className="history-card-main">
                  <span className={`meeting-status ${statusClass(meeting.pipelineStatus)}`}>
                    {statusLabel(meeting.pipelineStatus)}
                  </span>
                  <h2>{meeting.voiceChannelName ?? "Informação indisponível"}</h2>
                  <p>
                    {formatDate(meeting.startedAt, history.timeZone)} ·{" "}
                    {meeting.durationMs === null
                      ? "Em andamento"
                      : formatDuration(meeting.durationMs)}
                  </p>
                </div>
                <div className="participant-preview">
                  {meeting.participants === null ? (
                    <span>Participantes: Informação indisponível</span>
                  ) : (
                    <span>
                      Participantes:{" "}
                      {meeting.participants
                        .slice(0, 3)
                        .map((participant) => participant.displayName)
                        .join(", ")}
                      {meeting.participants.length > 3
                        ? ` +${String(meeting.participants.length - 3)}`
                        : ""}
                    </span>
                  )}
                  <div className="talk-time-preview">
                    <strong>Talk time</strong>
                    {meeting.participants?.some(
                      (participant) => participant.percentage !== null,
                    ) ? (
                      meeting.participants.slice(0, 3).map((participant) => (
                        <span key={participant.userId}>
                          {participant.displayName} — {String(participant.percentage)}%
                        </span>
                      ))
                    ) : (
                      <span>Informação indisponível</span>
                    )}
                  </div>
                </div>
                <Link className="card-action" to={`/history/${meeting.meetingId}`}>
                  Ver detalhes <ChevronRight />
                </Link>
              </article>
            ))}
          </div>
          <div className="pagination">
            <Button
              className="secondary"
              disabled={page === 1}
              onClick={() => setPage((current) => current - 1)}
            >
              Anterior
            </Button>
            <span>
              Página {page} de {Math.max(1, Math.ceil(history.total / history.pageSize))}
            </span>
            <Button
              className="secondary"
              disabled={page * history.pageSize >= history.total}
              onClick={() => setPage((current) => current + 1)}
            >
              Próxima
            </Button>
          </div>
          <p className="timezone-note">Datas e filtros usam o fuso {history.timeZone}.</p>
        </>
      )}
    </Page>
  );
}

export function MeetingHistoryDetailPage() {
  const { meetingId = "" } = useParams();
  const navigate = useNavigate();
  const selection = useServerSelection();
  const [meeting, setMeeting] = useState<MeetingHistoryDetail>();
  const [loadError, setLoadError] = useState(false);
  useEffect(() => {
    if (selection.selectedGuildId.length === 0) return;
    setMeeting(undefined);
    void api
      .getMeeting(selection.selectedGuildId, meetingId)
      .then(setMeeting)
      .catch(() => setLoadError(true));
  }, [meetingId, selection.selectedGuildId]);
  return (
    <Page
      title="Detalhes da call"
      eyebrow="Histórico"
      description="Participação, estado e conteúdo preservado desta reunião."
    >
      {selection.guilds !== undefined && selection.guilds.length > 0 && (
        <ServerSelector
          guilds={selection.guilds}
          onChange={(value) => {
            selection.setSelectedGuildId(value);
            navigate("/history");
          }}
          value={selection.selectedGuildId}
        />
      )}
      {selection.error || loadError ? (
        <EmptyState title="Call indisponível">
          <Link to="/history">Voltar ao histórico</Link>
        </EmptyState>
      ) : selection.guilds !== undefined && selection.guilds.length === 0 ? (
        <EmptyState title="Nenhum servidor instalado">
          Instale o Summyz para consultar calls.
        </EmptyState>
      ) : meeting === undefined ? (
        <Loading />
      ) : (
        <>
          <section className="panel meeting-overview">
            <span className={`meeting-status ${statusClass(meeting.pipelineStatus)}`}>
              {statusLabel(meeting.pipelineStatus)}
            </span>
            <h2>{meeting.voiceChannelName ?? "Informação indisponível"}</h2>
            <p>
              {formatDate(meeting.startedAt, meeting.timeZone)} ·{" "}
              {meeting.durationMs === null ? "Em andamento" : formatDuration(meeting.durationMs)}
            </p>
          </section>
          <section className="panel">
            <h2>Participantes e talk time</h2>
            {meeting.participants === null ? (
              <p className="muted">Informação indisponível</p>
            ) : meeting.participants.every((participant) => participant.percentage === 0) ? (
              <p className="muted">Nenhuma fala detectada.</p>
            ) : null}
            {meeting.participants !== null && (
              <div className="talk-time-list">
                {meeting.participants.map((participant) => (
                  <div key={participant.userId}>
                    <strong>{participant.displayName}</strong>
                    <span>
                      {participant.percentage === null
                        ? "Informação indisponível"
                        : `${String(participant.percentage)}%`}
                    </span>
                    {participant.percentage !== null && (
                      <i style={{ width: `${String(participant.percentage)}%` }} />
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
          <section className="panel retained-content">
            <h2>Resumo</h2>
            {meeting.summary === null ? (
              <p className="muted">Conteúdo não retido.</p>
            ) : (
              <MeetingSummaryContent summary={meeting.summary} />
            )}
          </section>
          <section className="panel retained-content">
            <h2>Transcrição</h2>
            {meeting.transcript === null ? (
              <p className="muted">Conteúdo não retido.</p>
            ) : (
              <pre>{meeting.transcript}</pre>
            )}
          </section>
        </>
      )}
    </Page>
  );
}

function formatDuration(milliseconds: number): string {
  if (milliseconds < 60_000) return `${String(Math.floor(milliseconds / 1_000))}s`;
  const totalMinutes = Math.floor(milliseconds / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${String(minutes)}m`;
  return `${String(hours)}h ${String(minutes).padStart(2, "0")}m`;
}

function formatCosts(costs: DashboardAnalytics["confirmedCost"]): string {
  if (costs.length === 0) return "—";
  return costs
    .map(
      (cost) =>
        `${cost.currency} ${cost.amount.toLocaleString("pt-BR", { maximumFractionDigits: 6 })}`,
    )
    .join(" · ");
}

function formatDate(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(new Date(value));
}

function statusLabel(status: string): string {
  if (status === "completed") return "Concluída";
  if (status === "failed") return "Falhou";
  return "Em andamento";
}

function statusClass(status: string): string {
  return status === "completed" ? "completed" : status === "failed" ? "failed" : "progress";
}

const meetingSummaryTexts = {
  en: {
    assignee: "Assignee",
    deadline: "Deadline",
    decisions: "Decisions",
    discussedTopics: "Discussed topics",
    executiveSummary: "Executive summary",
    failure:
      "The summary could not be generated after the configured attempts. The summary is unavailable, but the full transcript is available below.",
    observations: "Open issues and notes",
    tasks: "Tasks",
  },
  "pt-BR": {
    assignee: "Responsável",
    deadline: "Prazo",
    decisions: "Decisões",
    discussedTopics: "Tópicos discutidos",
    executiveSummary: "Resumo executivo",
    failure:
      "Não foi possível gerar o resumo após as tentativas configuradas. O resumo está indisponível, mas a transcrição completa está disponível abaixo.",
    observations: "Pendências e observações",
    tasks: "Tarefas",
  },
} as const;

function MeetingSummaryContent({ summary }: { summary: MeetingHistorySummary }) {
  const fallbackText = meetingSummaryTexts[summary.language === "en" ? "en" : "pt-BR"];
  if (summary.status === "failed") return <p className="muted">{fallbackText.failure}</p>;
  const text =
    summary.labels === undefined
      ? fallbackText
      : {
          ...fallbackText,
          assignee: summary.labels.assignee,
          deadline: summary.labels.deadline,
          decisions: summary.labels.decisions,
          discussedTopics: summary.labels.discussedTopics,
          executiveSummary: summary.labels.executiveSummary,
          observations: summary.labels.observations,
          tasks: summary.labels.tasks,
        };
  return (
    <div className="meeting-summary-content">
      <section>
        <h3>{text.executiveSummary}</h3>
        <p>{summary.executiveSummary}</p>
      </section>
      <SummaryList title={text.discussedTopics} items={summary.discussedTopics} />
      <SummaryList title={text.decisions} items={summary.decisions} />
      {summary.tasks.length > 0 && (
        <section>
          <h3>{text.tasks}</h3>
          <ul>
            {summary.tasks.map((task, index) => {
              const details = [
                task.ownerName === undefined ? undefined : `${text.assignee}: ${task.ownerName}`,
                task.deadlineText === undefined
                  ? undefined
                  : `${text.deadline}: ${task.deadlineText}`,
              ].filter((item): item is string => item !== undefined);
              return (
                <li key={`${String(index)}:${task.text}`}>
                  <span>{task.text}</span>
                  {details.length > 0 && <small>{details.join(" · ")}</small>}
                </li>
              );
            })}
          </ul>
        </section>
      )}
      <SummaryList title={text.observations} items={summary.observations} />
    </div>
  );
}

function SummaryList({ items, title }: { items: readonly string[]; title: string }) {
  if (items.length === 0) return null;
  return (
    <section>
      <h3>{title}</h3>
      <ul>
        {items.map((item, index) => (
          <li key={`${String(index)}:${item}`}>{item}</li>
        ))}
      </ul>
    </section>
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

export function ProfilesPage() {
  const user = useOutletContext<User>();
  const [items, setItems] = useState<ProfileListItem[]>();
  const [profileType, setProfileType] = useState<Profile["profileType"]>("external");
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const loadProfiles = useCallback(async () => {
    setLoadError(false);
    setItems(undefined);
    try {
      const next = await api.listProfiles();
      setItems(next);
      setSelectedProfileId(
        next.find((item) => item.profile.profileType === "external")?.profile.profileId ?? null,
      );
    } catch {
      setLoadError(true);
    }
  }, []);
  useEffect(() => {
    void loadProfiles();
  }, [loadProfiles]);
  if (loadError) {
    return (
      <Page
        title="Não foi possível carregar seus perfis"
        eyebrow="Perfis pessoais"
        description="Não foi possível concluir a consulta necessária. Tente novamente."
      >
        <EmptyState title="Perfis indisponíveis">
          <Button onClick={() => void loadProfiles()} type="button">
            Tentar novamente
          </Button>
        </EmptyState>
      </Page>
    );
  }
  if (items === undefined) return <Loading />;
  const visibleItems = items.filter((item) => item.profile.profileType === profileType);
  const selected =
    visibleItems.find((item) => item.profile.profileId === selectedProfileId)?.profile ??
    visibleItems[0]?.profile ??
    null;
  function selectType(nextType: Profile["profileType"]) {
    setProfileType(nextType);
    setSelectedProfileId(
      (items ?? []).find((item) => item.profile.profileType === nextType)?.profile.profileId ??
        null,
    );
  }
  return (
    <Page
      title="Seus perfis"
      eyebrow="Configuração global"
      description="Crie configurações pessoais e escolha qual delas cada servidor deve usar."
    >
      <div className="profile-type-tabs" role="tablist" aria-label="Tipo de execução">
        <button
          aria-selected={profileType === "external"}
          className={profileType === "external" ? "active" : ""}
          onClick={() => selectType("external")}
          role="tab"
          type="button"
        >
          API externa
        </button>
        <button
          aria-selected={profileType === "local"}
          className={profileType === "local" ? "active" : ""}
          onClick={() => selectType("local")}
          role="tab"
          type="button"
        >
          Local
        </button>
      </div>
      <ProfileEditor
        items={visibleItems}
        locale={user.dashboardLanguage}
        selected={selected}
        selectedProfileId={selected?.profileId ?? null}
        onItemsChange={(nextVisible) =>
          setItems([
            ...items.filter((item) => item.profile.profileType !== profileType),
            ...nextVisible,
          ])
        }
        onSelect={setSelectedProfileId}
      />
    </Page>
  );
}

export function nextLocalizedProfileName(
  items: ReadonlyArray<{ profile: { name: string } }>,
  locale: "en" | "pt-BR",
): string {
  const prefix = locale === "pt-BR" ? "Perfil" : "Profile";
  const existingNames = new Set(items.map(({ profile }) => profile.name.toLocaleLowerCase(locale)));
  let nextNumber = 1;
  while (existingNames.has(`${prefix} ${nextNumber}`.toLocaleLowerCase(locale))) {
    nextNumber += 1;
  }
  return `${prefix} ${nextNumber}`;
}

const profileLanguageOptions = [
  "auto",
  "ar",
  "cs",
  "da",
  "de",
  "el",
  "en",
  "en-GB",
  "en-US",
  "es",
  "es-ES",
  "es-MX",
  "fi",
  "fr",
  "fr-CA",
  "he",
  "hi",
  "hu",
  "id",
  "it",
  "ja",
  "ko",
  "nl",
  "no",
  "pl",
  "pt",
  "pt-BR",
  "pt-PT",
  "ro",
  "ru",
  "sv",
  "th",
  "tr",
  "uk",
  "vi",
  "zh",
  "zh-CN",
  "zh-TW",
] as const;

function LanguageSelector({
  onChange,
  value,
}: {
  onChange: (value: (typeof profileLanguageOptions)[number]) => void;
  value: (typeof profileLanguageOptions)[number];
}) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLocaleLowerCase("pt-BR");
  const visibleOptions = profileLanguageOptions.filter(
    (language) =>
      language === value ||
      normalizedQuery.length === 0 ||
      language.toLocaleLowerCase("pt-BR").includes(normalizedQuery),
  );
  return (
    <div className="field language-selector">
      <span>Idioma</span>
      <input
        aria-label="Pesquisar idioma"
        autoComplete="off"
        onChange={(event) => setQuery(event.currentTarget.value)}
        placeholder="Pesquisar uma tag BCP 47"
        type="search"
        value={query}
      />
      <select
        aria-label="Idioma"
        onChange={(event) => {
          const selected = profileLanguageOptions.find(
            (language) => language === event.currentTarget.value,
          );
          if (selected !== undefined) onChange(selected);
        }}
        value={value}
      >
        {visibleOptions.map((language) => (
          <option key={language} value={language}>
            {language === "auto" ? "auto — recomendado" : language}
          </option>
        ))}
      </select>
      {visibleOptions.length === 1 && visibleOptions[0] === value && normalizedQuery.length > 0 && (
        <small>Nenhuma outra tag corresponde à pesquisa.</small>
      )}
    </div>
  );
}

function ProfileEditor({
  items,
  locale,
  onSelect,
  onItemsChange,
  selected,
  selectedProfileId,
}: {
  items: ProfileListItem[];
  locale: "en" | "pt-BR";
  onSelect: (id: string) => void;
  onItemsChange: (value: ProfileListItem[]) => void;
  selected: Profile | null;
  selectedProfileId: string | null;
}) {
  const [draft, setDraft] = useState<Profile | null>(selected);
  const [promptDefaults, setPromptDefaults] = useState<PromptDefaults>();
  const [transcriptionTab, setTranscriptionTab] = useState<"model" | "vad">("model");
  const previousPromptDefaults = useRef<PromptDefaults | undefined>(undefined);
  const promptProfileId = draft?.profileId;
  const promptSummaryLanguage = draft?.language;
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
          current.language !== summaryLanguage ||
          previous === undefined
        ) {
          return current;
        }
        return profileSchema.parse({
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
        });
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
    const currentItem = items.find((item) => item.profile.profileId === currentDraft.profileId);
    if (
      currentItem?.active === true &&
      !window.confirm(
        "Este perfil está ativo em um ou mais servidores. As alterações valerão nas próximas reuniões. Deseja salvar?",
      )
    ) {
      return;
    }
    await api.updateProfile(currentDraft);
    onItemsChange(
      items.map((item) =>
        item.profile.profileId === currentDraft.profileId
          ? { ...item, profile: currentDraft }
          : item,
      ),
    );
  }
  async function create() {
    const { profileId: _profileId, userId: _userId, ...base } = currentDraft;
    const created = await api.createProfile({
      ...base,
      name: nextLocalizedProfileName(items, locale),
    });
    onItemsChange([...items, { active: false, profile: created }]);
    onSelect(created.profileId);
  }
  async function remove() {
    await api.deleteProfile(currentDraft.profileId);
    const remaining = items.filter((item) => item.profile.profileId !== currentDraft.profileId);
    onItemsChange(remaining);
    onSelect(remaining[0]?.profile.profileId ?? "");
  }
  return (
    <>
      <div className="section-title profile-heading">
        <span>
          <Bot />
        </span>
        <div>
          <h2>Perfis de IA</h2>
          <p>Configure modelos e parâmetros reutilizáveis em seus servidores.</p>
        </div>
        <Button className="secondary" onClick={create}>
          Novo perfil
        </Button>
      </div>
      <div className="profile-tabs">
        {items.map(({ active, profile }) => (
          <button
            className={profile.profileId === selectedProfileId ? "active" : ""}
            key={profile.profileId}
            onClick={() => onSelect(profile.profileId)}
            type="button"
          >
            {profile.name}
            {active && <i>Em uso</i>}
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
        </div>
        <LanguageSelector
          value={currentDraft.language}
          onChange={(language) => {
            const translation =
              language === "auto"
                ? null
                : (currentDraft.translation ?? {
                    generation: {},
                    model: null,
                    prompt: null,
                    provider: currentDraft.profileType === "external" ? "openrouter" : "ollama",
                  });
            setDraft(profileSchema.parse({ ...currentDraft, language, translation }));
          }}
        />
        <p className="field-hint">
          Em auto, o resumo usa o idioma predominante. Se o idioma escolhido já for exatamente o
          predominante da call, a tradução será ignorada e não gerará custo.
        </p>
        <PhaseEditor
          phase="Transcrição"
          profile={currentDraft}
          promptDefaults={promptDefaults}
          transcriptionTab={transcriptionTab}
          onTranscriptionTabChange={setTranscriptionTab}
          onChange={(next) => setDraft(profileSchema.parse(next))}
        />
        {currentDraft.language !== "auto" && currentDraft.translation !== null && (
          <TranslationEditor
            profile={currentDraft}
            onChange={(next) => setDraft(profileSchema.parse(next))}
          />
        )}
        <PhaseEditor
          phase="Refinamento"
          profile={currentDraft}
          promptDefaults={promptDefaults}
          onChange={(next) => setDraft(profileSchema.parse(next))}
        />
        <PhaseEditor
          phase="Resumo"
          profile={currentDraft}
          promptDefaults={promptDefaults}
          onChange={(next) => setDraft(profileSchema.parse(next))}
        />
        <div className="form-actions">
          <Button type="submit">Salvar perfil</Button>
          <Button
            className="danger"
            disabled={
              items.length === 1 ||
              items.some((item) => item.profile.profileId === currentDraft.profileId && item.active)
            }
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

function VadEditor({
  onChange,
  profile,
}: {
  onChange: (profile: unknown) => void;
  profile: Profile;
}) {
  const vad = profile.transcription.vad;
  const replace = (nextVad: unknown) => {
    onChange({
      ...profile,
      transcription: { ...profile.transcription, vad: nextVad },
    });
  };
  return (
    <div className="vad-editor stack">
      <Toggle
        checked={vad.enabled}
        description="Quando desativado, o áudio completo segue diretamente para a transcrição."
        label="Detectar presença de voz"
        onChange={(enabled) => replace({ ...vad, enabled })}
      />
      <div className="form-grid">
        <Field
          hint="Probabilidade mínima para iniciar uma região de fala."
          label="Limiar de fala"
          max={1}
          min={profile.profileType === "external" ? 0.15 : 0}
          step={0.01}
          type="number"
          value={vad.threshold}
          onChange={(event) => replace({ ...vad, threshold: event.currentTarget.valueAsNumber })}
        />
        <Field
          hint="Ignora eventos de voz menores que esta duração."
          label="Fala mínima (ms)"
          max={2_000}
          min={profile.profileType === "external" ? 32 : 0}
          type="number"
          value={vad.minSpeechDurationMs}
          onChange={(event) =>
            replace({ ...vad, minSpeechDurationMs: event.currentTarget.valueAsNumber })
          }
        />
        <Field
          hint="Mantém áudio ao redor das bordas para evitar palavras cortadas."
          label="Margem de fala (ms)"
          max={5_000}
          min={0}
          type="number"
          value={vad.speechPadMs}
          onChange={(event) => replace({ ...vad, speechPadMs: event.currentTarget.valueAsNumber })}
        />
        {profile.profileType === "external" ? (
          <Field
            hint="Silêncio contínuo necessário para encerrar uma região."
            label="Silêncio para encerrar (ms)"
            max={10_000}
            min={32}
            type="number"
            value={profile.transcription.vad.minSilenceDurationMs}
            onChange={(event) =>
              replace({ ...vad, minSilenceDurationMs: event.currentTarget.valueAsNumber })
            }
          />
        ) : (
          <Field
            hint="Use “auto” para preservar 2.000 ms no modo normal e 160 ms em lote."
            label="Silêncio para encerrar"
            value={profile.transcription.vad.minSilenceDurationMs}
            onChange={(event) => {
              const raw = event.currentTarget.value;
              replace({ ...vad, minSilenceDurationMs: raw === "auto" ? "auto" : Number(raw) });
            }}
          />
        )}
      </div>
      <details className="advanced-settings">
        <summary>Configurações avançadas</summary>
        <div className="form-grid">
          <Field
            hint="Use “auto” para manter 0,15 abaixo do limiar de fala."
            label="Limiar negativo"
            value={vad.negativeSpeechThreshold}
            onChange={(event) => {
              const raw = event.currentTarget.value;
              replace({
                ...vad,
                negativeSpeechThreshold: raw === "auto" ? "auto" : Number(raw),
              });
            }}
          />
          {profile.profileType === "local" && (
            <Field
              hint="Use “auto” para preservar o limite próprio do modo de execução."
              label="Duração máxima da fala (s)"
              value={profile.transcription.vad.maxSpeechDurationSeconds}
              onChange={(event) => {
                const raw = event.currentTarget.value;
                replace({
                  ...vad,
                  maxSpeechDurationSeconds: raw === "auto" ? "auto" : Number(raw),
                });
              }}
            />
          )}
        </div>
      </details>
    </div>
  );
}

function PhaseEditor({
  onChange,
  onTranscriptionTabChange,
  phase,
  profile,
  promptDefaults,
  transcriptionTab,
}: {
  onChange: (profile: unknown) => void;
  onTranscriptionTabChange?: (tab: "model" | "vad") => void;
  phase: "Transcrição" | "Refinamento" | "Resumo";
  profile: Profile;
  promptDefaults: PromptDefaults | undefined;
  transcriptionTab?: "model" | "vad";
}) {
  if (phase === "Transcrição") {
    const value = profile.transcription;
    const selectedTab = transcriptionTab ?? "model";
    return (
      <fieldset className="phase">
        <legend>{phase}</legend>
        <div aria-label="Configuração da transcrição" className="phase-tabs" role="tablist">
          <button
            aria-selected={selectedTab === "model"}
            className={selectedTab === "model" ? "active" : ""}
            onClick={() => onTranscriptionTabChange?.("model")}
            role="tab"
            type="button"
          >
            Modelo e transcrição
          </button>
          <button
            aria-selected={selectedTab === "vad"}
            className={selectedTab === "vad" ? "active" : ""}
            onClick={() => onTranscriptionTabChange?.("vad")}
            role="tab"
            type="button"
          >
            VAD
          </button>
        </div>
        {selectedTab === "model" ? (
          <>
            <div className="form-grid">
              <SelectField disabled label="Provedor" value={value.provider ?? ""}>
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
            <div className="form-grid">
              {profile.profileType === "local" && (
                <Field
                  label="Tamanho do lote"
                  placeholder="auto ou 0–64"
                  value={profile.transcription.batchSize}
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
              )}
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
              disabledMessage="Sem prompt editável. O prompt-base imutável do Summyz continuará ativo."
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
          </>
        ) : (
          <VadEditor profile={profile} onChange={onChange} />
        )}
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
        <SelectField disabled label="Provedor" value={value.provider ?? ""}>
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
          disabledMessage="Sem prompt editável. O prompt-base imutável do Summyz continuará ativo."
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
            disabledMessage="Sem prompt editável. O prompt-base imutável do Summyz continuará ativo."
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
            disabledMessage="Sem prompt editável. O prompt-base imutável do Summyz continuará ativo."
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

function TranslationEditor({
  onChange,
  profile,
}: {
  onChange: (profile: unknown) => void;
  profile: Profile;
}) {
  const value = profile.translation;
  if (value === null) return null;
  const replace = (translation: typeof value) => onChange({ ...profile, translation });
  return (
    <fieldset className="phase">
      <legend>Tradução</legend>
      <p className="field-hint">
        Esta fase adiciona uma chamada ao modelo. Se falhar, o resumo-base será publicado no idioma
        predominante e o autor do /record receberá uma DM privada.
      </p>
      <div className="form-grid">
        <SelectField disabled label="Provedor" value={value.provider}>
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
      <button
        className="text-button"
        onClick={() => replace({ ...value, model: profile.summary.model })}
        type="button"
      >
        Usar modelo do resumo
      </button>
      <details className="advanced-settings">
        <summary>Configurações avançadas</summary>
        <div className="form-grid">
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
                generation: {
                  ...value.generation,
                  temperature:
                    event.currentTarget.value === ""
                      ? undefined
                      : event.currentTarget.valueAsNumber,
                },
              })
            }
          />
          <Field
            label="Seed"
            type="number"
            value={value.generation.seed ?? ""}
            onChange={(event) =>
              replace({
                ...value,
                generation: {
                  ...value.generation,
                  seed:
                    event.currentTarget.value === ""
                      ? undefined
                      : event.currentTarget.valueAsNumber,
                },
              })
            }
          />
        </div>
        <Toggle
          checked={value.generation.think ?? false}
          description="Encaminha think=true quando o provedor oferece suporte."
          label="Raciocínio do modelo"
          onChange={(think) => replace({ ...value, generation: { ...value.generation, think } })}
        />
        <PromptEditor
          defaultPrompt="Traduza somente os campos permitidos e preserve os termos protegidos."
          disabledMessage="Sem prompt editável. O prompt-base imutável do Summyz continuará ativo."
          label="Prompt de tradução"
          toggleLabel="Usar prompt de tradução"
          value={value.prompt}
          onChange={(prompt) => replace({ ...value, prompt })}
        />
      </details>
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
        description="Desative para remover somente a personalização; o prompt-base continuará ativo."
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
              ? "O texto editável será removido do perfil. O prompt-base imutável continuará sendo enviado."
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
