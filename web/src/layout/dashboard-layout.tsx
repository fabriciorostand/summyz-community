import { X } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useId, useMemo, useState } from "react";
import { Outlet, useOutletContext } from "react-router-dom";

import { type GuildSelection, useGuildSelection } from "../hooks/use-guild-selection";
import { useTheme } from "../hooks/use-theme";
import { useI18n } from "../i18n/store";
import { api, type DashboardAnalytics, type DashboardSettings } from "../lib/api";
import type { ThemePreference } from "../lib/theme";
import { NavigationContext, type NavigationControl, NavigationDrawer } from "./navigation";
import { Sidebar } from "./sidebar";
import { GuildPicker, LanguagePicker, ThemeToggle } from "./top-bar";

export type DashboardPeriod = "30d" | "90d" | "all";

export interface DashboardContext {
  /** Guild, language and theme pickers, ready to drop into a screen header. */
  controls: ReactNode;
  dashboard: DashboardAnalytics | undefined;
  dashboardError: boolean;
  guilds: GuildSelection;
  /** Applies a change already confirmed by the server without waiting for a reload. */
  patchSettings(patch: Partial<DashboardSettings>): void;
  period: DashboardPeriod;
  reloadDashboard(): void;
  reloadSettings(): Promise<DashboardSettings | undefined>;
  setPeriod(value: DashboardPeriod): void;
  /** The theme belongs to this browser, like the language and the date formats. */
  setTheme(value: ThemePreference): void;
  /** Installation-wide settings: access mode and which secrets exist. */
  settings: DashboardSettings;
  theme: ThemePreference;
}

export function useDashboard(): DashboardContext {
  return useOutletContext<DashboardContext>();
}

/**
 * The dashboard analytics feed both the overview screen and the sidebar counters, so the
 * layout owns that request and shares the result with the routes underneath.
 */
export function DashboardLayout({ settings: initialSettings }: { settings: DashboardSettings }) {
  const guilds = useGuildSelection();
  const { t, timeZone } = useI18n();
  const [settings, setSettings] = useState(initialSettings);
  const theme = useTheme();
  const [period, setPeriod] = useState<DashboardPeriod>("30d");
  const [dashboard, setDashboard] = useState<DashboardAnalytics>();
  const [dashboardError, setDashboardError] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const drawerId = useId();
  const navigation = useMemo<NavigationControl>(
    () => ({ drawerId, open: navigationOpen, show: () => setNavigationOpen(true) }),
    [drawerId, navigationOpen],
  );
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
      .getDashboard(selectedGuildId, period, timeZone)
      .then((next) => {
        if (active) setDashboard(next);
      })
      .catch(() => {
        if (active) setDashboardError(true);
      });
    return () => {
      active = false;
    };
  }, [period, reloadToken, selectedGuildId, timeZone]);

  const reloadDashboard = useCallback(() => setReloadToken((token) => token + 1), []);

  const patchSettings = useCallback(
    (patch: Partial<DashboardSettings>) => setSettings((current) => ({ ...current, ...patch })),
    [],
  );

  // The settings are loaded once when the shell mounts, so screens that change them ask for a
  // refresh instead of trusting a local copy. A failed refresh keeps the last known state: the
  // API client already reports an expired session, and the screens stay usable otherwise.
  const reloadSettings = useCallback(
    () =>
      api.getSettings().then(
        (next) => {
          setSettings(next);
          return next;
        },
        () => undefined,
      ),
    [],
  );

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
        {/* Phones keep only the guild context; language and theme stay in Preferences. */}
        <div className="hidden items-center gap-2 sm:flex">
          <LanguagePicker />
          <ThemeToggle onChange={theme.setPreference} value={theme.preference} />
        </div>
      </>
    ),
    dashboard,
    dashboardError,
    guilds,
    patchSettings,
    period,
    reloadDashboard,
    reloadSettings,
    setPeriod,
    setTheme: theme.setPreference,
    settings,
    theme: theme.preference,
  };

  return (
    <NavigationContext.Provider value={navigation}>
      <div className="flex min-h-screen bg-canvas text-ink">
        <Sidebar callCount={dashboard?.totalCalls} openTaskCount={dashboard?.openTaskCount} />
        <div className="flex min-w-0 flex-1 flex-col">
          <Outlet context={context} />
        </div>
      </div>
      <NavigationDrawer
        id={drawerId}
        onClose={() => setNavigationOpen(false)}
        open={navigationOpen}
      >
        {(close) => (
          <Sidebar
            action={
              <button
                aria-label={t.nav.closeMenu}
                className="grid size-10 shrink-0 place-items-center rounded-lg text-ink-muted transition-colors hover:bg-surface-inset hover:text-ink"
                onClick={close}
                type="button"
              >
                <X className="size-4" />
              </button>
            }
            callCount={dashboard?.totalCalls}
            onNavigate={close}
            openTaskCount={dashboard?.openTaskCount}
            variant="drawer"
          />
        )}
      </NavigationDrawer>
    </NavigationContext.Provider>
  );
}
