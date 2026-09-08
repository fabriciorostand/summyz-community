import { ChevronDown, Globe, Moon, Sun } from "lucide-react";
import type { ReactNode } from "react";

import { Avatar } from "../components/ui";
import type { Guild } from "../lib/api";
import type { ThemePreference } from "../lib/theme";

export function GuildPicker({
  guilds,
  onChange,
  value,
}: {
  guilds: readonly Guild[];
  onChange: (value: string) => void;
  value: string;
}) {
  const selected = guilds.find((guild) => guild.id === value);
  if (selected === undefined) return null;
  return (
    <div className="relative flex items-center gap-2 rounded-lg border border-line bg-surface-raised py-1.5 pr-2 pl-2">
      <Avatar avatarUrl={selected.iconUrl} name={selected.name} size={20} />
      <span className="text-[12.5px] font-medium text-ink">{selected.name}</span>
      <ChevronDown className="size-3.5 text-ink-muted" />
      <select
        aria-label="Servidor"
        className="absolute inset-0 cursor-pointer opacity-0"
        onChange={(event) => onChange(event.currentTarget.value)}
        value={value}
      >
        {guilds.map((guild) => (
          <option key={guild.id} value={guild.id}>
            {guild.name}
          </option>
        ))}
      </select>
    </div>
  );
}

export function LanguagePicker({
  onChange,
  value,
}: {
  onChange: (value: "en" | "pt-BR") => void;
  value: "en" | "pt-BR";
}) {
  return (
    <div className="relative flex items-center gap-1.5 rounded-lg border border-line bg-surface-raised px-2 py-1.5">
      <Globe className="size-3.5 text-ink-muted" />
      <span className="font-mono text-[11px] text-ink-secondary">
        {value === "pt-BR" ? "PT-BR" : "EN"}
      </span>
      <ChevronDown className="size-3.5 text-ink-muted" />
      <select
        aria-label="Idioma do dashboard"
        className="absolute inset-0 cursor-pointer opacity-0"
        onChange={(event) => onChange(event.currentTarget.value === "en" ? "en" : "pt-BR")}
        value={value}
      >
        <option value="pt-BR">Português (Brasil)</option>
        <option value="en">English</option>
      </select>
    </div>
  );
}

export function ThemeToggle({
  onChange,
  value,
}: {
  onChange: (value: ThemePreference) => void;
  value: ThemePreference;
}) {
  const isDark = value === "dark" || (value === "system" && !prefersLight());
  return (
    <button
      aria-label={isDark ? "Usar tema claro" : "Usar tema escuro"}
      className="grid size-[30px] place-items-center rounded-lg border border-line bg-surface-raised text-ink-muted transition-colors hover:text-ink"
      onClick={() => onChange(isDark ? "light" : "dark")}
      type="button"
    >
      {isDark ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
    </button>
  );
}

function prefersLight(): boolean {
  if (typeof matchMedia !== "function") return false;
  return matchMedia("(prefers-color-scheme: light)").matches;
}

export function TopBar({
  actions,
  breadcrumb,
  meta,
  title,
}: {
  actions?: ReactNode;
  breadcrumb?: ReactNode;
  meta?: ReactNode;
  title: ReactNode;
}) {
  return (
    <header className="flex h-[58px] shrink-0 items-center gap-3.5 border-b border-line-soft bg-surface-rail px-6">
      {breadcrumb}
      <h1 className="m-0 text-[17px] font-semibold tracking-tight text-ink">{title}</h1>
      {meta !== undefined && <span className="label-mono text-ink-muted">{meta}</span>}
      <div className="ml-auto flex items-center gap-2">{actions}</div>
    </header>
  );
}
