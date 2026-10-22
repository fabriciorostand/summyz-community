import { DiscordNotConnectedState, ErrorState, GuildRemovedState } from "../../components/states";
import { useBotInstallation } from "../../hooks/use-bot-installation";
import { useI18n } from "../../i18n/store";
import { ApiError, type Guild } from "../../lib/api";

export type GuildLoadFailure =
  | "discord_account_not_connected"
  | "discord_rate_limited"
  | "guild_access_denied"
  | "request_failed";

/** Any other 403 means the bot is not there or the server belongs to another account. */
export function guildLoadFailureOf(caught: unknown): GuildLoadFailure {
  if (!(caught instanceof ApiError)) return "request_failed";
  if (caught.code === "discord_account_not_connected") return caught.code;
  if (caught.code === "discord_rate_limited") return caught.code;
  return caught.status === 403 ? "guild_access_denied" : "request_failed";
}

export function GuildLoadFailureState({
  failure,
  guild,
  onRetry,
}: {
  failure: GuildLoadFailure;
  guild: Guild | undefined;
  onRetry: () => void;
}) {
  const { t } = useI18n();
  switch (failure) {
    case "discord_account_not_connected":
      return <DiscordNotConnectedState />;
    case "guild_access_denied":
      return <InaccessibleGuild guild={guild} />;
    case "discord_rate_limited":
      return (
        <ErrorState code={failure} onRetry={onRetry} title={t.states.discordRateLimitedTitle}>
          {t.states.discordRateLimitedBody}
        </ErrorState>
      );
    case "request_failed":
      return (
        <ErrorState code={failure} onRetry={onRetry} title={t.guild.unavailableTitle}>
          {t.guild.unavailableBody}
        </ErrorState>
      );
  }
}

function InaccessibleGuild({ guild }: { guild: Guild | undefined }) {
  // The server's own link preselects it on Discord; the generic one is the fallback.
  const { installUrl } = useBotInstallation();
  return <GuildRemovedState guildName={guild?.name} installUrl={guild?.installUrl ?? installUrl} />;
}
