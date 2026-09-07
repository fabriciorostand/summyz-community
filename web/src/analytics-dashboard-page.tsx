import { CalendarDays, Clock3, Mic2, Users, WalletCards } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { formatCosts, formatDuration } from "./analytics-format";
import { api, type DashboardAnalytics } from "./api";
import { EmptyState, Loading } from "./components";
import { ServerSelector, useServerSelection } from "./dashboard-layout";
import { Page } from "./dashboard-shared";

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
      <DashboardContent dashboard={dashboard} loadError={loadError} selection={selection} />
    </Page>
  );
}

function DashboardContent({
  dashboard,
  loadError,
  selection,
}: {
  dashboard: DashboardAnalytics | undefined;
  loadError: boolean;
  selection: ReturnType<typeof useServerSelection>;
}) {
  if (selection.error || loadError) {
    return (
      <EmptyState title="Dashboard indisponível">Não foi possível carregar as métricas.</EmptyState>
    );
  }
  if (
    selection.guilds === undefined ||
    (selection.selectedGuildId.length > 0 && dashboard === undefined)
  ) {
    return <Loading />;
  }
  if (selection.guilds.length === 0) {
    return (
      <EmptyState title="Nenhum servidor instalado">
        Instale o Summyz em um servidor para acompanhar suas calls.
      </EmptyState>
    );
  }
  if (dashboard === undefined) return null;
  return (
    <>
      <ServerSelector
        guilds={selection.guilds}
        onChange={selection.setSelectedGuildId}
        value={selection.selectedGuildId}
      />
      <DashboardMetrics dashboard={dashboard} />
      <SpeakerPanel dashboard={dashboard} />
      <p className="timezone-note">Datas e filtros usam o fuso {dashboard.timeZone}.</p>
    </>
  );
}

function DashboardMetrics({ dashboard }: { dashboard: DashboardAnalytics }) {
  return (
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
  );
}

function SpeakerPanel({ dashboard }: { dashboard: DashboardAnalytics }) {
  return (
    <section className="panel speaker-panel">
      <div className="analytics-section-heading">
        <div>
          <span className="eyebrow">Todo o período</span>
          <h2>Top speakers</h2>
        </div>
        <Mic2 />
      </div>
      {dashboard.topSpeakers.length === 0 ? (
        <p className="muted">O talk time estará disponível após a primeira call nova concluída.</p>
      ) : (
        <div className="speaker-list">
          {dashboard.topSpeakers.map((speaker, index) => (
            <div className="speaker-row" key={speaker.userId}>
              <div>
                <strong>{speaker.displayName}</strong>
                <span>{formatDuration(speaker.talkTimeMs)}</span>
              </div>
              <span
                className={`speaker-bar tone-${String(index + 1)}`}
                style={{ width: speakerWidth(dashboard, speaker.talkTimeMs) }}
              />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function speakerWidth(dashboard: DashboardAnalytics, talkTimeMs: number): string {
  const maximum = dashboard.topSpeakers[0]?.talkTimeMs ?? 1;
  return `${Math.max(4, (talkTimeMs / maximum) * 100)}%`;
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
