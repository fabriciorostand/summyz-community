import { type ReactNode, useCallback, useEffect, useState } from "react";
import { Outlet, useNavigate, useOutletContext } from "react-router-dom";

import { type GuildSelection, useGuildSelection } from "../hooks/use-guild-selection";
import { useTheme } from "../hooks/use-theme";
import { api, type DashboardAnalytics, type User } from "../lib/api";
import type { ThemePreference } from "../lib/theme";
import { Sidebar } from "./sidebar";
import { GuildPicker, LanguagePicker, ThemeToggle } from "./top-bar";

export type DashboardPeriod = "30d" | "90d" | "all";

export interface DashboardContext {
  /** Guild, language and theme pickers, ready to drop into a screen header. */
  controls: ReactNode;
  dashboard: DashboardAnalytics | undefined;
  dashboardError: boolean;
  guilds: GuildSelection;
  period: DashboardPeriod;
  reloadDashboard(): void;
  setPeriod(value: DashboardPeriod): void;
  setPreferences(value: {
    dashboardLanguage: "en" | "pt-BR";
    dashboardTheme: ThemePreference;
  }): void;
  theme: ThemePreference;
  user: User;
}

export function useDashboard(): DashboardContext {
  return useOutletContext<DashboardContext>();
}

/**
 * The dashboard analytics feed both the overview screen and the sidebar counters, so the
 * layout owns that request and shares the result with the routes underneath.
 */
export function DashboardLayout({ user: initialUser }: { user: User }) {
  const navigate = useNavigate();
  const guilds = useGuildSelection();
  const [user, setUser] = useState(initialUser);
  const theme = useTheme(user.dashboardTheme);
  const [period, setPeriod] = useState<DashboardPeriod>("30d");
  const [dashboard, setDashboard] = useState<DashboardAnalytics>();
  const [dashboardError, setDashboardError] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const { selectedGuildId } = guilds;

  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadToken is the explicit refetch trigger.
  useEffect(() => {
    if (selectedGuildId.length === 0) {
      setDashboard(undefined);
      return;
    }
    let active = true;
    setDashboard(undefined);
    setDashboardError(false);
    void api
      .getDashboard(selectedGuildId, period)
      .then((next) => {
        if (active) setDashboard(next);
      })
      .catch(() => {
        if (active) setDashboardError(true);
      });
    return () => {
      active = false;
    };
  }, [period, reloadToken, selectedGuildId]);

  const reloadDashboard = useCallback(() => setReloadToken((token) => token + 1), []);

  async function logout() {
    await api.logout();
    navigate("/login");
  }

  function savePreferences(next: {
    dashboardLanguage: "en" | "pt-BR";
    dashboardTheme: ThemePreference;
  }) {
    setUser((current) => ({ ...current, ...next }));
    theme.setPreference(next.dashboardTheme);
    void api.updatePreferences(next.dashboardLanguage, next.dashboardTheme);
  }

  const context: DashboardContext = {
    controls: (
      <>
        {guilds.guilds !== undefined && guilds.guilds.length > 0 && (
          <GuildPicker
            guilds={guilds.guilds}
            onChange={guilds.setSelectedGuildId}
            value={guilds.selectedGuildId}
          />
        )}
        <LanguagePicker
          onChange={(dashboardLanguage) =>
            savePreferences({ dashboardLanguage, dashboardTheme: theme.preference })
          }
          value={user.dashboardLanguage}
        />
        <ThemeToggle
          onChange={(dashboardTheme) =>
            savePreferences({ dashboardLanguage: user.dashboardLanguage, dashboardTheme })
          }
          value={theme.preference}
        />
      </>
    ),
    dashboard,
    dashboardError,
    guilds,
    period,
    reloadDashboard,
    setPeriod,
    setPreferences: savePreferences,
    theme: theme.preference,
    user,
  };

  return (
    <div className="flex min-h-screen bg-canvas text-ink">
      <Sidebar
        callCount={dashboard?.totalCalls}
        onLogout={() => void logout()}
        openTaskCount={dashboard?.openTaskCount}
        user={user}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <Outlet context={context} />
      </div>
    </div>
  );
}
