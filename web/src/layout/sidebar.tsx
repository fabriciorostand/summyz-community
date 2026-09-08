import {
  Command,
  Gauge,
  LogOut,
  PhoneCall,
  Server,
  Settings,
  SlidersHorizontal,
  SquareCheckBig,
  UserRound,
} from "lucide-react";
import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { Avatar } from "../components/ui";
import type { User } from "../lib/api";

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5 px-2 pt-1.5 pb-5">
      <span className="grid size-7 place-items-center rounded-lg bg-action text-[13px] font-bold text-white">
        S
      </span>
      {!compact && (
        <span className="text-[14.5px] font-semibold tracking-tight text-ink">Summyz</span>
      )}
    </div>
  );
}

function NavGroup({ children, label }: { children: ReactNode; label: string }) {
  return (
    <>
      <div className="label-mono px-2.5 pb-2 text-ink-muted">{label}</div>
      <nav className="mb-4 grid gap-0.5">{children}</nav>
    </>
  );
}

function NavItem({
  count,
  icon,
  label,
  to,
  tone = "neutral",
}: {
  count?: number | undefined;
  icon: ReactNode;
  label: string;
  to: string;
  tone?: "neutral" | "alert";
}) {
  return (
    <NavLink
      className={({ isActive }) =>
        `flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] transition-colors ${
          isActive
            ? "bg-surface-inset font-medium text-ink"
            : "text-ink-secondary hover:bg-surface-inset/60 hover:text-ink"
        }`
      }
      end={to === "/"}
      to={to}
    >
      {({ isActive }) => (
        <>
          <span className={isActive ? "text-accent" : ""}>{icon}</span>
          {label}
          {count !== undefined && count > 0 && (
            <span
              className={`ml-auto font-mono text-[10px] ${tone === "alert" ? "text-fail" : "text-ink-muted"}`}
            >
              {count}
            </span>
          )}
        </>
      )}
    </NavLink>
  );
}

export function Sidebar({
  callCount,
  onLogout,
  openTaskCount,
  user,
}: {
  callCount: number | undefined;
  onLogout: () => void;
  openTaskCount: number | undefined;
  user: User;
}) {
  const iconClass = "size-[15px]";
  return (
    <aside className="flex w-[236px] shrink-0 flex-col border-r border-line-soft bg-surface-rail px-3 py-4.5">
      <Brand />
      <NavGroup label="Reuniões">
        <NavItem icon={<Gauge className={iconClass} />} label="Visão geral" to="/" />
        <NavItem
          count={callCount}
          icon={<PhoneCall className={iconClass} />}
          label="Calls"
          to="/history"
        />
        <NavItem
          count={openTaskCount}
          icon={<SquareCheckBig className={iconClass} />}
          label="Tarefas"
          to="/tasks"
          tone="alert"
        />
      </NavGroup>
      <NavGroup label="Configuração">
        <NavItem icon={<Server className={iconClass} />} label="Servidores" to="/servers" />
        <NavItem
          icon={<SlidersHorizontal className={iconClass} />}
          label="Perfis de IA"
          to="/profiles"
        />
        <NavItem icon={<Command className={iconClass} />} label="Comandos" to="/commands" />
      </NavGroup>
      <NavGroup label="Sistema">
        <NavItem icon={<UserRound className={iconClass} />} label="Minha conta" to="/account" />
        {user.installationRole === "administrator" && (
          <NavItem
            icon={<Settings className={iconClass} />}
            label="Instalação"
            to="/installation"
          />
        )}
      </NavGroup>
      <div className="mt-auto flex items-center gap-2.5 border-t border-line-soft pt-4">
        <Avatar name={user.email} />
        <span className="flex min-w-0 flex-1 flex-col">
          <strong className="truncate text-[11.5px] font-medium text-ink">{user.email}</strong>
          <small className="label-mono mt-0.5 text-ink-muted">
            {user.installationRole === "administrator" ? "Admin" : "Membro"}
          </small>
        </span>
        <button
          aria-label="Sair"
          className="rounded p-1 text-ink-muted transition-colors hover:bg-surface-inset hover:text-ink"
          onClick={onLogout}
          type="button"
        >
          <LogOut className="size-3.5" />
        </button>
      </div>
    </aside>
  );
}
