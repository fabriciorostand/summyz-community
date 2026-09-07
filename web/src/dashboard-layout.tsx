import {
  Bot,
  Command,
  History as HistoryIcon,
  LayoutDashboard,
  LogOut,
  Server,
  Settings,
  UserRound,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";

import { api, type Guild, type User } from "./api";
import { Brand, SelectField } from "./components";

export function DashboardLayout({ user }: { user: User }) {
  const navigate = useNavigate();
  async function logout() {
    await api.logout();
    navigate("/login");
  }
  return (
    <div className="dashboard-shell">
      <aside className="sidebar">
        <Brand />
        <nav>
          <NavItem icon={<LayoutDashboard />} label="Dashboard" to="/" />
          <NavItem icon={<HistoryIcon />} label="Histórico" to="/history" />
          <NavItem icon={<Server />} label="Servidores" to="/servers" />
          <NavItem icon={<Bot />} label="Perfis" to="/profiles" />
          <NavItem icon={<Command />} label="Comandos" to="/commands" />
          <NavItem icon={<UserRound />} label="Minha conta" to="/account" />
          {user.installationRole === "administrator" && (
            <NavItem icon={<Settings />} label="Instalação" to="/installation" />
          )}
        </nav>
        <div className="sidebar-user">
          <span className="avatar">{user.email.slice(0, 1).toUpperCase()}</span>
          <span>
            <strong>{user.email}</strong>
            <small>{user.installationRole === "administrator" ? "Administrador" : "Membro"}</small>
          </span>
          <button aria-label="Sair" onClick={logout} type="button">
            <LogOut />
          </button>
        </div>
      </aside>
      <main className="dashboard-main">
        <Outlet context={user} />
      </main>
    </div>
  );
}

function NavItem({ icon, label, to }: { icon: ReactNode; label: string; to: string }) {
  return (
    <NavLink className={({ isActive }) => (isActive ? "active" : "")} end={to === "/"} to={to}>
      {icon}
      <span>{label}</span>
    </NavLink>
  );
}

const selectedGuildStorageKey = "summyz:selected-guild";

export function useServerSelection(): {
  error: boolean;
  guilds: Guild[] | undefined;
  selectedGuildId: string;
  setSelectedGuildId(value: string): void;
} {
  const [guilds, setGuilds] = useState<Guild[]>();
  const [error, setError] = useState(false);
  const [selectedGuildId, setSelectedGuildIdState] = useState("");
  useEffect(() => {
    let active = true;
    void api
      .listGuilds()
      .then((allGuilds) => {
        if (!active) return;
        const installed = allGuilds.filter((guild) => guild.installed);
        const stored = localStorage.getItem(selectedGuildStorageKey);
        const selected = installed.some((guild) => guild.id === stored)
          ? (stored ?? "")
          : (installed[0]?.id ?? "");
        setGuilds(installed);
        setSelectedGuildIdState(selected);
        if (selected.length > 0) localStorage.setItem(selectedGuildStorageKey, selected);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, []);
  return {
    error,
    guilds,
    selectedGuildId,
    setSelectedGuildId(value) {
      localStorage.setItem(selectedGuildStorageKey, value);
      setSelectedGuildIdState(value);
    },
  };
}

export function ServerSelector({
  guilds,
  onChange,
  value,
}: {
  guilds: readonly Guild[];
  onChange(value: string): void;
  value: string;
}) {
  return (
    <div className="server-selector">
      <SelectField
        label="Servidor"
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
      >
        {guilds.map((guild) => (
          <option key={guild.id} value={guild.id}>
            {guild.name}
          </option>
        ))}
      </SelectField>
    </div>
  );
}
