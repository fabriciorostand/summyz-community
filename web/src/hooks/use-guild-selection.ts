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
  /** Every server the account owns, installed or not. The Servers screen needs both. */
  allGuilds: Guild[] | undefined;
  error: boolean;
  /** Only the servers with the bot installed, which is what the dashboard can be scoped to. */
  guilds: Guild[] | undefined;
  reload(): void;
  selectedGuild: Guild | undefined;
  selectedGuildId: string;
  setSelectedGuildId(value: string): void;
}

/** Loads the installed servers and remembers which one the dashboard is scoped to. */
export function useGuildSelection(): GuildSelection {
  const [allGuilds, setAllGuilds] = useState<Guild[]>();
  const [guilds, setGuilds] = useState<Guild[]>();
  const [error, setError] = useState(false);
  const [selectedGuildId, setSelectedGuildIdState] = useState("");
  const [reloadToken, setReloadToken] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadToken is the explicit refetch trigger.
  useEffect(() => {
    let active = true;
    setError(false);
    setAllGuilds(undefined);
    setGuilds(undefined);
    void api
      .listGuilds()
      .then((allGuilds) => {
        if (!active) return;
        const installed = allGuilds.filter((guild) => guild.installed);
        const stored = readStoredGuildId();
        const selected = installed.some((guild) => guild.id === stored)
          ? (stored ?? "")
          : (installed[0]?.id ?? "");
        setAllGuilds(allGuilds);
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
    allGuilds,
    error,
    guilds,
    reload: useCallback(() => setReloadToken((token) => token + 1), []),
    selectedGuild: guilds?.find((guild) => guild.id === selectedGuildId),
    selectedGuildId,
    setSelectedGuildId,
  };
}
