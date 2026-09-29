import { useCallback, useEffect, useState } from "react";
import { Navigate, Outlet, useLocation, useOutletContext } from "react-router-dom";

import { ErrorState, FullPageLoading, SessionExpiredState } from "./components/states";
import { useI18n } from "./i18n/store";
import { DashboardLayout } from "./layout/dashboard-layout";
import { useNavigationProgress } from "./layout/navigation-progress";
import {
  type AccessMode,
  type AccessStatus,
  ApiError,
  api,
  type DashboardSettings,
  subscribeToSessionExpiry,
} from "./lib/api";

/** What the setup, unlock and dashboard routes need from the access check above them. */
export interface AccessContext {
  accessMode: AccessMode;
  expireSession(): void;
  /** Reads the access status again, after the setup or the unlock changed it. */
  refresh(): void;
}

export function useAccess(): AccessContext {
  return useOutletContext<AccessContext>();
}

/** The only screen each access state may show; anything else redirects there. */
function allowedPath(status: AccessStatus, pathname: string): string | null {
  if (!status.setupCompleted) return pathname === "/setup" ? null : "/setup";
  if (status.accessMode === "public" && !status.authenticated) {
    return pathname === "/login" ? null : "/login";
  }
  return pathname === "/login" || pathname === "/setup" ? "/" : null;
}

/**
 * There are no user accounts: the access status decides between the first-run setup, the
 * installation password (public mode only) and the dashboard itself.
 */
export function App() {
  useNavigationProgress();
  const { t } = useI18n();
  const { pathname } = useLocation();
  const [status, setStatus] = useState<AccessStatus>();
  const [unreachable, setUnreachable] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const expireSession = useCallback(() => setSessionExpired(true), []);
  const refresh = useCallback(() => setAttempt((current) => current + 1), []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt is the explicit retry trigger.
  useEffect(() => {
    let active = true;
    setUnreachable(false);
    void api.getAccessStatus().then(
      (next) => {
        if (active) setStatus(next);
      },
      () => {
        if (active) setUnreachable(true);
      },
    );
    return () => {
      active = false;
    };
  }, [attempt]);

  // Without this the dashboard would spin forever whenever the API is down.
  if (unreachable) {
    return (
      <div className="grid min-h-screen place-items-center bg-canvas p-6">
        <div className="w-full max-w-md">
          <ErrorState code="request_failed" onRetry={refresh} title={t.app.unreachableTitle}>
            {t.app.unreachableBody}
          </ErrorState>
        </div>
      </div>
    );
  }

  if (status === undefined) return <FullPageLoading />;

  if (sessionExpired) {
    return (
      <div className="grid min-h-screen place-items-center bg-canvas p-6">
        <div className="w-full max-w-md">
          <SessionExpiredState
            onUnlock={() => {
              setSessionExpired(false);
              setStatus({ ...status, authenticated: false });
            }}
          />
        </div>
      </div>
    );
  }

  const redirect = allowedPath(status, pathname);
  if (redirect !== null) return <Navigate replace to={redirect} />;
  const context: AccessContext = { accessMode: status.accessMode, expireSession, refresh };
  return <Outlet context={context} />;
}

export function AuthenticatedArea() {
  const { expireSession } = useAccess();
  const [settings, setSettings] = useState<DashboardSettings>();

  useEffect(() => subscribeToSessionExpiry(expireSession), [expireSession]);

  useEffect(() => {
    void api
      .getSettings()
      .then(setSettings)
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 401) expireSession();
      });
  }, [expireSession]);

  if (settings === undefined) return <FullPageLoading />;
  return <DashboardLayout settings={settings} />;
}
