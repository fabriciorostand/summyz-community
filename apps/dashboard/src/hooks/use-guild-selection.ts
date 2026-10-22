import { useCallback, useEffect, useState } from "react";

import { api, type Guild } from "../lib/api";

const storageKey = "summyz:selected-guild";

function readStoredGuildId(): string | null {
  try {
    return localStorage.getItem(storageKey);
  } catch {
    return null;
  }
}

function storeGuildId(guildId: string): void {
  try {
    localStorage.setItem(storageKey, guildId);
  } catch {
    // Selecting a server must keep working even when storage is blocked.
  }
}

export interface GuildSelection {
  error: boolean;
  /** The servers the bot is currently in; the backend decides what is visible. */
  guilds: Guild[] | undefined;
  reload(): void;
  selectedGuild: Guild | undefined;
  selectedGuildId: string;
  setSelectedGuildId(value: string): void;
}

/** Loads the servers the bot is in and remembers which one the dashboard is scoped to. */
export function useGuildSelection(): GuildSelection {
  const [guilds, setGuilds] = useState<Guild[]>();
  const [error, setError] = useState(false);
  const [selectedGuildId, setSelectedGuildIdState] = useState("");
  const [reloadToken, setReloadToken] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadToken is the explicit refetch trigger.
  useEffect(() => {
    let active = true;
    setError(false);
    setGuilds(undefined);
    void api
      .listGuilds()
      .then((installed) => {
        if (!active) return;
        const stored = readStoredGuildId();
        const selected = installed.some((guild) => guild.id === stored)
          ? (stored ?? "")
          : (installed[0]?.id ?? "");
        setGuilds(installed);
        setSelectedGuildIdState(selected);
        if (selected.length > 0) storeGuildId(selected);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [reloadToken]);

  const setSelectedGuildId = useCallback((value: string) => {
    storeGuildId(value);
    setSelectedGuildIdState(value);
  }, []);

  return {
    error,
    guilds,
    reload: useCallback(() => setReloadToken((token) => token + 1), []),
    selectedGuild: guilds?.find((guild) => guild.id === selectedGuildId),
    selectedGuildId,
    setSelectedGuildId,
  };
}
