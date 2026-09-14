import {
  Command,
  Gauge,
  PhoneCall,
  Server,
  Settings,
  SlidersHorizontal,
  SlidersVertical,
  SquareCheckBig,
} from "lucide-react";
import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";

export function Brand({ label = "Summyz", size = 28 }: { label?: string; size?: number }) {
  return (
    <div className="flex items-center gap-2.5">
      <img
        alt="Summyz"
        className="block shrink-0 object-contain"
        height={size}
        src="/summyz-logo.png"
        style={{ height: `${String(size)}px`, width: `${String(size)}px` }}
        width={size}
      />
      <span className="text-[14.5px] font-semibold tracking-tight text-ink">{label}</span>
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

/** No account footer: the design has no user identity, only the installation itself. */
export function Sidebar({
  callCount,
  openTaskCount,
}: {
  callCount: number | undefined;
  openTaskCount: number | undefined;
}) {
  const iconClass = "size-[15px]";
  return (
    <aside className="flex w-[236px] shrink-0 flex-col border-r border-line-soft bg-surface-rail px-3 py-4.5">
      <div className="px-2 pt-1.5 pb-5">
        <Brand />
      </div>
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
        <NavItem
          icon={<SlidersVertical className={iconClass} />}
          label="Preferências"
          to="/settings"
        />
        <NavItem icon={<Settings className={iconClass} />} label="Instalação" to="/installation" />
      </NavGroup>
    </aside>
  );
}
