import { useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";

import { ErrorState, FullPageLoading } from "./components/states";
import { DashboardLayout } from "./layout/dashboard-layout";
import { ApiError, api, type SetupStatus, type User } from "./lib/api";
import { AccountPage } from "./pages/account-page";
import { CallDetailPage } from "./pages/call-detail-page";
import { CallsPage } from "./pages/calls-page";
import { CommandsPage } from "./pages/commands-page";
import { GuildPage } from "./pages/guild-page";
import { InstallationPage } from "./pages/installation-page";
import { LoginPage } from "./pages/login-page";
import { OverviewPage } from "./pages/overview-page";
import { ProfilesPage } from "./pages/profiles/profiles-page";
import { ServersPage } from "./pages/servers-page";
import { SetupPage } from "./pages/setup-page";
import { TasksPage } from "./pages/tasks-page";

export function App() {
  const [status, setStatus] = useState<SetupStatus>();
  const [unreachable, setUnreachable] = useState(false);
  const [attempt, setAttempt] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt is the explicit retry trigger.
  useEffect(() => {
    let active = true;
    setUnreachable(false);
    void api.getSetupStatus().then(
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

  if (!status.setupCompleted) {
    return (
      <Routes>
        <Route
          element={<SetupPage onComplete={() => setStatus({ ...status, setupCompleted: true })} />}
          path="/setup"
        />
        <Route element={<Navigate replace to="/setup" />} path="*" />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route element={<LoginPage />} path="/login" />
      <Route element={<AuthenticatedArea />}>
        <Route element={<OverviewPage />} index />
        <Route element={<CallsPage />} path="history" />
        <Route element={<CallDetailPage />} path="history/:meetingId" />
        <Route element={<TasksPage />} path="tasks" />
        <Route element={<ServersPage />} path="servers" />
        <Route element={<GuildPage />} path="guilds/:guildId" />
        <Route element={<ProfilesPage />} path="profiles" />
        <Route element={<CommandsPage />} path="commands" />
        <Route element={<AccountPage />} path="account" />
        <Route element={<InstallationPage />} path="installation" />
      </Route>
      <Route element={<Navigate replace to="/" />} path="*" />
    </Routes>
  );
}

function AuthenticatedArea() {
  const location = useLocation();
  const [user, setUser] = useState<User>();
  const [unauthorized, setUnauthorized] = useState(false);

  useEffect(() => {
    void api
      .me()
      .then(setUser)
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 401) setUnauthorized(true);
      });
  }, []);

  if (unauthorized) return <Navigate replace state={{ from: location }} to="/login" />;
  if (user === undefined) return <FullPageLoading />;
  return <DashboardLayout user={user} />;
}
