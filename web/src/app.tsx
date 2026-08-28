import { useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";

import { api, ApiError, type SetupStatus, type User } from "./api";
import {
  ForgotPasswordPage,
  LoginPage,
  RegisterPage,
  ResetPasswordPage,
  SetupPage,
  VerifyPage,
} from "./auth-pages";
import { Loading } from "./components";
import {
  AccountPage,
  CommandsPage,
  DashboardLayout,
  GuildConfigurationPage,
  GuildsPage,
  InstallationPage,
} from "./dashboard-pages";

export function App() {
  const [status, setStatus] = useState<SetupStatus>();
  useEffect(() => {
    void api.getSetupStatus().then(setStatus);
  }, []);
  if (status === undefined) return <Loading />;
  if (!status.setupCompleted) {
    return (
      <Routes>
        <Route
          path="/setup"
          element={
            <SetupPage
              onComplete={() => setStatus({ ...status, setupCompleted: true })}
              status={status}
            />
          }
        />
        <Route path="*" element={<Navigate replace to="/setup" />} />
      </Routes>
    );
  }
  return (
    <Routes>
      <Route
        path="/login"
        element={<LoginPage registrationEnabled={status.registrationEnabled} />}
      />
      <Route
        path="/register"
        element={status.registrationEnabled ? <RegisterPage /> : <Navigate replace to="/login" />}
      />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/verify" element={<VerifyPage />} />
      <Route path="/verify-email" element={<VerifyPage />} />
      <Route element={<AuthenticatedArea />}>
        <Route index element={<GuildsPage />} />
        <Route path="account" element={<AccountPage />} />
        <Route path="commands" element={<CommandsPage />} />
        <Route path="guilds/:guildId" element={<GuildConfigurationPage />} />
        <Route path="installation" element={<InstallationPage />} />
      </Route>
      <Route path="*" element={<Navigate replace to="/" />} />
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
  if (user === undefined) return <Loading />;
  return <DashboardLayout user={user} />;
}
