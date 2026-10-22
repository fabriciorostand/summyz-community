import {
  ArrowRight,
  CircleAlert,
  CircleCheck,
  History,
  type LucideIcon,
  RefreshCw,
  ServerOff,
} from "lucide-react";
import { Link } from "react-router-dom";

import {
  ErrorState,
  InstallBotLink,
  LoadingPanel,
  NoServerState,
  secondaryLinkClass,
} from "../components/states";
import { Avatar, Button, Card } from "../components/ui";
import { useBotInstallation } from "../hooks/use-bot-installation";
import { useI18n } from "../i18n/store";
import { useDashboard } from "../layout/dashboard-layout";
import { TopBar } from "../layout/top-bar";
import type { Guild } from "../lib/api";
import { Screen } from "./screen";
import { ConnectOwnerBanner, OAuthResultNotice } from "./servers/owner-notices";

/**
 * Lists the connected owner's servers, with or without the bot, plus the ones only kept for
 * their recorded history.
 */
export function ServersPage() {
  const { guilds } = useDashboard();
  const { t } = useI18n();
  const { installUrl } = useBotInstallation();
  const list = guilds.guilds;
  return (
    <>
      <TopBar
        actions={
          <Button onClick={guilds.reload} size="toolbar" type="button" variant="secondary">
            <RefreshCw className="size-3.5" />
            {t.servers.refresh}
          </Button>
        }
        title={t.servers.title}
        wrappedActionsAlign="start"
      />
      <Screen>
        <OAuthResultNotice />
        <ConnectOwnerBanner />
        {guilds.error ? (
          <ErrorState
            code="request_failed"
            onRetry={guilds.reload}
            secondaryAction={
              <Link className={secondaryLinkClass} to="/bot">
                {t.servers.openBot}
              </Link>
            }
            title={t.servers.unavailableTitle}
          >
            {t.servers.unavailableBody}
          </ErrorState>
        ) : list === undefined ? (
          <LoadingPanel label={t.servers.loading} />
        ) : list.length === 0 ? (
          <NoServerState installUrl={installUrl} />
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
            {list.map((guild) => (
              <GuildCard guild={guild} key={guild.id} onSelect={guilds.setSelectedGuildId} />
            ))}
          </div>
        )}
      </Screen>
    </>
  );
}

type GuildStatus = "configured" | "missingSetup" | "notInstalled" | "historyOnly";

function statusOf(guild: Guild): GuildStatus {
  if (!guild.installed) return guild.owned ? "notInstalled" : "historyOnly";
  return guild.activeProfile != null && guild.summaryForum != null ? "configured" : "missingSetup";
}

const statusStyles: Record<GuildStatus, { className: string; icon: LucideIcon }> = {
  configured: { className: "text-ok", icon: CircleCheck },
  historyOnly: { className: "text-ink-muted", icon: History },
  missingSetup: { className: "text-warn", icon: CircleAlert },
  notInstalled: { className: "text-ink-muted", icon: ServerOff },
};

function GuildCard({ guild, onSelect }: { guild: Guild; onSelect: (guildId: string) => void }) {
  const { t } = useI18n();
  const status = statusOf(guild);
  const { className, icon: Icon } = statusStyles[status];
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <Avatar avatarUrl={guild.iconUrl} name={guild.name} size={40} />
        <div className="min-w-0 flex-1">
          <h3 className="m-0 truncate text-[15px] font-semibold tracking-tight text-ink">
            {guild.name}
          </h3>
          <div className={`mt-1 flex items-center gap-1.5 text-[11.5px] ${className}`}>
            <Icon className="size-3.5" />
            <span>{t.servers[status]}</span>
          </div>
        </div>
      </div>
      {/* The body takes the free height so every action lines up at the bottom of its card. */}
      {guild.installed ? (
        <GuildFacts guild={guild} />
      ) : (
        <div className={`flex flex-1 ${status === "notInstalled" ? "items-center" : ""}`}>
          <p className="m-0 text-[12.5px] leading-relaxed text-ink-muted">
            {status === "notInstalled" ? t.servers.notInstalledBody : t.servers.historyOnlyBody}
          </p>
        </div>
      )}
      <GuildAction guild={guild} onSelect={onSelect} status={status} />
    </Card>
  );
}

function GuildFacts({ guild }: { guild: Guild }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-1 flex-col">
      <GuildFact
        label={t.servers.activeProfile}
        value={guild.activeProfile?.name ?? t.servers.none}
      />
      <GuildFact
        label={t.servers.summaryForum}
        value={guild.summaryForum?.name ?? t.servers.notConfigured}
      />
    </div>
  );
}

function GuildAction({
  guild,
  onSelect,
  status,
}: {
  guild: Guild;
  onSelect: (guildId: string) => void;
  status: GuildStatus;
}) {
  const { t } = useI18n();
  if (status === "notInstalled") {
    return (
      <InstallBotLink installUrl={guild.installUrl ?? undefined}>
        {t.servers.installHere}
      </InstallBotLink>
    );
  }
  if (status === "historyOnly") {
    // The history screens follow the selected server, so pick this one before opening them.
    return (
      <Link className={secondaryLinkClass} onClick={() => onSelect(guild.id)} to="/history">
        {t.servers.viewHistory}
        <ArrowRight className="size-3.5" />
      </Link>
    );
  }
  return (
    <Link
      className="inline-flex items-center justify-center gap-2 rounded-lg bg-action-gradient px-3.5 py-2 text-[13.5px] font-medium text-white transition-colors hover:bg-action-gradient-hover"
      to={`/guilds/${guild.id}`}
    >
      {t.servers.configure}
      <ArrowRight className="size-3.5" />
    </Link>
  );
}

function GuildFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line-soft py-2 last:border-0">
      <span className="text-[12px] text-ink-muted">{label}</span>
      <span className="truncate text-right text-[12px] text-ink-secondary">{value}</span>
    </div>
  );
}
