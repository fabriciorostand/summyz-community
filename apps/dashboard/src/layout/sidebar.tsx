import {
  Bot,
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
import type { DashboardSettings } from "../lib/api";
import { SidebarAccount } from "./sidebar-account";

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
  // The fixed rail only fits next to the content from the desktop breakpoint up. It stays pinned
  // to the screen while the page scrolls, so the owner's account at its foot is always in view.
  drawer: "flex h-full w-full",
  rail: "hidden w-[236px] shrink-0 border-r border-line-soft lg:sticky lg:top-0 lg:flex lg:h-dvh",
} as const;

/**
 * The foot shows the Discord account that owns the servers. It is not a dashboard user: the
 * installation has no user accounts, so there is no sign-out here.
 */
export function Sidebar({
  action,
  callCount,
  onNavigate,
  openTaskCount,
  settings,
  variant = "rail",
}: {
  action?: ReactNode;
  callCount: number | undefined;
  onNavigate?: () => void;
  openTaskCount: number | undefined;
  settings: DashboardSettings;
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
      {/* Only the navigation scrolls on short screens; the account below never leaves view. */}
      <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:thin]">
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
            icon={<Bot className={iconClass} />}
            label={nav.bot}
            to="/bot"
          />
          <NavItem
            onNavigate={onNavigate}
            icon={<Settings className={iconClass} />}
            label={nav.installation}
            to="/installation"
          />
        </NavGroup>
      </div>
      <SidebarAccount onNavigate={onNavigate} settings={settings} />
    </aside>
  );
}
