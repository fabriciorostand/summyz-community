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

import { useI18n } from "../i18n/store";

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
  onNavigate,
  to,
  tone = "neutral",
}: {
  count?: number | undefined;
  icon: ReactNode;
  label: string;
  onNavigate: (() => void) | undefined;
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
      onClick={onNavigate}
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

const sidebarVariants = {
  // The fixed rail only fits next to the content from the desktop breakpoint up.
  drawer: "flex min-h-full w-full",
  rail: "hidden w-[236px] shrink-0 border-r border-line-soft lg:flex",
} as const;

/** No account footer: the design has no user identity, only the installation itself. */
export function Sidebar({
  action,
  callCount,
  onNavigate,
  openTaskCount,
  variant = "rail",
}: {
  action?: ReactNode;
  callCount: number | undefined;
  onNavigate?: () => void;
  openTaskCount: number | undefined;
  variant?: keyof typeof sidebarVariants;
}) {
  const { nav } = useI18n().t;
  const iconClass = "size-[15px]";
  return (
    <aside className={`flex-col bg-surface-rail px-3 py-4.5 ${sidebarVariants[variant]}`}>
      <div className="flex items-center justify-between gap-2 px-2 pt-1.5 pb-5">
        <Brand />
        {action}
      </div>
      <NavGroup label={nav.meetings}>
        <NavItem
          onNavigate={onNavigate}
          icon={<Gauge className={iconClass} />}
          label={nav.overview}
          to="/"
        />
        <NavItem
          onNavigate={onNavigate}
          count={callCount}
          icon={<PhoneCall className={iconClass} />}
          label={nav.calls}
          to="/history"
        />
        <NavItem
          onNavigate={onNavigate}
          count={openTaskCount}
          icon={<SquareCheckBig className={iconClass} />}
          label={nav.tasks}
          to="/tasks"
          tone="alert"
        />
      </NavGroup>
      <NavGroup label={nav.configuration}>
        <NavItem
          onNavigate={onNavigate}
          icon={<Server className={iconClass} />}
          label={nav.servers}
          to="/servers"
        />
        <NavItem
          onNavigate={onNavigate}
          icon={<SlidersHorizontal className={iconClass} />}
          label={nav.profiles}
          to="/profiles"
        />
        <NavItem
          onNavigate={onNavigate}
          icon={<Command className={iconClass} />}
          label={nav.commands}
          to="/commands"
        />
      </NavGroup>
      <NavGroup label={nav.system}>
        <NavItem
          onNavigate={onNavigate}
          icon={<SlidersVertical className={iconClass} />}
          label={nav.preferences}
          to="/settings"
        />
        <NavItem
          onNavigate={onNavigate}
          icon={<Settings className={iconClass} />}
          label={nav.installation}
          to="/installation"
        />
      </NavGroup>
    </aside>
  );
}
