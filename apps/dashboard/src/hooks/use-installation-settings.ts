import { useEffect } from "react";

import { useDashboard } from "../layout/dashboard-layout";
import type { DashboardSettings } from "../lib/api";

/**
 * Settings for a screen that writes them: read again from the server when the screen opens,
 * since the shared snapshot may predate a save made there.
 */
export function useInstallationSettings(): {
  reloadSettings: ReturnType<typeof useDashboard>["reloadSettings"];
  secretSaved: (secret: keyof DashboardSettings["secrets"]) => (configured: boolean) => void;
  settings: DashboardSettings;
} {
  const { patchSettings, reloadSettings, settings } = useDashboard();

  useEffect(() => {
    void reloadSettings();
  }, [reloadSettings]);

  // The write succeeded, so reflect it right away and let the reload confirm it.
  const secretSaved = (secret: keyof DashboardSettings["secrets"]) => (configured: boolean) => {
    patchSettings({ secrets: { ...settings.secrets, [secret]: configured } });
    void reloadSettings();
  };

  return { reloadSettings, secretSaved, settings };
}
