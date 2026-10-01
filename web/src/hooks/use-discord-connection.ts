import { useCallback, useEffect, useState } from "react";

import { ApiError, api, type DiscordConnection } from "../lib/api";
import { leaveDashboardFor } from "../lib/browser-navigation";

export function useDiscordConnection(applicationId?: string | null): {
  connection: DiscordConnection | undefined;
  loadFailed: boolean;
} {
  const [connection, setConnection] = useState<DiscordConnection>();
  const [loadFailed, setLoadFailed] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: applicationId is the explicit refetch trigger.
  useEffect(() => {
    let active = true;
    setConnection(undefined);
    setLoadFailed(false);
    void api.getDiscordConnection().then(
      (next) => {
        if (active) setConnection(next);
      },
      () => {
        if (active) setLoadFailed(true);
      },
    );
    return () => {
      active = false;
    };
  }, [applicationId]);
  return { connection, loadFailed };
}

const knownConnectFailures = [
  "discord_bot_not_configured",
  "discord_client_secret_missing",
  "discord_rate_limited",
] as const;

export type DiscordConnectFailure = (typeof knownConnectFailures)[number] | "request_failed";

function connectFailureOf(caught: unknown): DiscordConnectFailure {
  const code = caught instanceof ApiError ? caught.code : undefined;
  return knownConnectFailures.find((known) => known === code) ?? "request_failed";
}

export function useDiscordConnect(): {
  connect(): Promise<void>;
  connecting: boolean;
  failure: DiscordConnectFailure | undefined;
} {
  const [connecting, setConnecting] = useState(false);
  const [failure, setFailure] = useState<DiscordConnectFailure>();
  const connect = useCallback(async () => {
    setConnecting(true);
    setFailure(undefined);
    try {
      leaveDashboardFor(await api.startDiscordConnection());
    } catch (caught) {
      setFailure(connectFailureOf(caught));
      setConnecting(false);
    }
  }, []);
  return { connect, connecting, failure };
}
