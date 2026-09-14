import { useCallback, useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import { ErrorState, FullPageLoading, SessionExpiredState } from "./components/states";
import { DashboardLayout } from "./layout/dashboard-layout";
import {
  type AccessStatus,
  ApiError,
  api,
  type DashboardSettings,
  subscribeToSessionExpiry,
} from "./lib/api";
import { CallDetailPage } from "./pages/call-detail-page";
import { CallsPage } from "./pages/calls-page";
import { CommandsPage } from "./pages/commands-page";
import { GuildPage } from "./pages/guild-page";
import { InstallationPage } from "./pages/installation-page";
import { OverviewPage } from "./pages/overview-page";
import { PreferencesPage } from "./pages/preferences-page";
import { ProfilesPage } from "./pages/profiles/profiles-page";
import { ServersPage } from "./pages/servers-page";
import { SetupPage } from "./pages/setup-page";
import { TasksPage } from "./pages/tasks-page";
import { UnlockPage } from "./pages/unlock-page";

/**
 * There are no user accounts: the access status decides between the first-run setup, the
 * installation password (public mode only) and the dashboard itself.
 */
export function App() {
  const [status, setStatus] = useState<AccessStatus>();
  const [unreachable, setUnreachable] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const expireSession = useCallback(() => setSessionExpired(true), []);

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
          <ErrorState
            code="request_failed"
            onRetry={() => setAttempt((current) => current + 1)}
            title="Não foi possível falar com o servidor"
          >
            O dashboard não conseguiu consultar a API. Isso não afeta as gravações em andamento.
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

  if (!status.setupCompleted) {
    return (
      <Routes>
        <Route
          element={
            <SetupPage
              accessMode={status.accessMode}
              onComplete={() => setAttempt((current) => current + 1)}
            />
          }
          path="/setup"
        />
        <Route element={<Navigate replace to="/setup" />} path="*" />
      </Routes>
    );
  }

  const locked = status.accessMode === "public" && !status.authenticated;
  return (
    <Routes>
      <Route
        element={
          locked ? (
            <UnlockPage onUnlocked={() => setAttempt((current) => current + 1)} />
          ) : (
            <Navigate replace to="/" />
          )
        }
        path="/login"
      />
      {locked ? (
        <Route element={<Navigate replace to="/login" />} path="*" />
      ) : (
        <>
          <Route element={<AuthenticatedArea onSessionExpired={expireSession} />}>
            <Route element={<OverviewPage />} index />
            <Route element={<CallsPage />} path="history" />
            <Route element={<CallDetailPage />} path="history/:meetingId" />
            <Route element={<TasksPage />} path="tasks" />
            <Route element={<ServersPage />} path="servers" />
            <Route element={<GuildPage />} path="guilds/:guildId" />
            <Route element={<ProfilesPage />} path="profiles" />
            <Route element={<CommandsPage />} path="commands" />
            <Route element={<PreferencesPage />} path="settings" />
            <Route element={<InstallationPage />} path="installation" />
          </Route>
          <Route element={<Navigate replace to="/" />} path="*" />
        </>
      )}
    </Routes>
  );
}

function AuthenticatedArea({ onSessionExpired }: { onSessionExpired: () => void }) {
  const [settings, setSettings] = useState<DashboardSettings>();

  useEffect(() => subscribeToSessionExpiry(onSessionExpired), [onSessionExpired]);

  useEffect(() => {
    void api
      .getSettings()
      .then(setSettings)
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 401) onSessionExpired();
      });
  }, [onSessionExpired]);

  if (settings === undefined) return <FullPageLoading />;
  return <DashboardLayout settings={settings} />;
}
