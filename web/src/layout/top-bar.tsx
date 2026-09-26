import { Globe, Moon, Sun } from "lucide-react";
import type { ReactNode } from "react";

import { Select } from "../components/select";
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
  if (!guilds.some((guild) => guild.id === value)) return null;
  return (
    <Select
      aria-label="Servidor"
      onChange={onChange}
      options={guilds.map((guild) => ({
        label: guild.name,
        leading: (
          <Avatar avatarUrl={guild.iconUrl} fallbackTone="action" name={guild.name} size={20} />
        ),
        value: guild.id,
      }))}
      value={value}
      variant="toolbar"
    />
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
    <Select
      aria-label="Idioma do dashboard"
      onChange={onChange}
      options={[
        { label: "Português (Brasil)", value: "pt-BR" },
        { label: "English", value: "en" },
      ]}
      renderValue={() => (
        <>
          <Globe className="size-3.5 text-ink-muted" />
          <span className="font-mono text-[11px] font-normal text-ink-secondary">
            {value === "pt-BR" ? "PT-BR" : "EN"}
          </span>
        </>
      )}
      value={value}
      variant="toolbar"
    />
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
