import { Globe, Menu, Moon, Sun } from "lucide-react";
import { type ReactNode, useContext } from "react";

import { Select } from "../components/select";
import { Avatar } from "../components/ui";
import { languageNames, languages } from "../i18n/preferences";
import { setLanguage, useI18n } from "../i18n/store";
import type { Guild } from "../lib/api";
import type { ThemePreference } from "../lib/theme";
import { NavigationContext } from "./navigation";

export function GuildPicker({
  guilds,
  onChange,
  value,
}: {
  guilds: readonly Guild[];
  onChange: (value: string) => void;
  value: string;
}) {
  const { t } = useI18n();
  if (!guilds.some((guild) => guild.id === value)) return null;
  // Long guild names shorten with an ellipsis instead of pushing the header past the screen.
  return (
    <div className="flex min-w-0 max-w-44 sm:max-w-xs">
      <Select
        aria-label={t.topBar.guild}
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
    </div>
  );
}

/** Compact language switch; the choice belongs to this browser, not to the installation. */
export function LanguagePicker() {
  const { language, t } = useI18n();
  return (
    <Select
      aria-label={t.topBar.language}
      onChange={setLanguage}
      options={languages.map((value) => ({ label: languageNames[value], value }))}
      renderValue={() => (
        <>
          <Globe className="size-3.5 text-ink-muted" />
          <span className="font-mono text-[11px] font-normal text-ink-secondary">
            {language === "pt-BR" ? "PT-BR" : "EN"}
          </span>
        </>
      )}
      value={language}
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
  const { t } = useI18n();
  const isDark = value === "dark" || (value === "system" && !prefersLight());
  return (
    <button
      aria-label={isDark ? t.topBar.useLightTheme : t.topBar.useDarkTheme}
      className="grid size-[34px] place-items-center rounded-lg border border-line bg-surface-raised text-ink-muted transition-colors hover:text-ink"
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
  title,
  wrappedActionsAlign = "end",
}: {
  actions?: ReactNode;
  breadcrumb?: ReactNode;
  title: ReactNode;
  /** Side the actions take once they wrap onto their own row. */
  wrappedActionsAlign?: "end" | "start";
}) {
  // The title group shrinks first (the title truncates); when the actions still do not fit,
  // they wrap onto a second row instead of leaving the screen. While they share the row, the
  // growing title group keeps them at the right edge either way.
  const actionsAlignment = wrappedActionsAlign === "end" ? "ml-auto justify-end" : "justify-start";
  return (
    <header className="flex min-h-[58px] shrink-0 flex-wrap items-center gap-x-3.5 gap-y-2 border-b border-line-soft bg-surface-rail px-4 py-2.5 sm:px-6">
      <div className="flex min-w-0 flex-auto flex-wrap items-center gap-x-3.5 gap-y-1">
        <MenuButton />
        {breadcrumb}
        <h1 className="m-0 min-w-0 truncate text-[17px] font-semibold tracking-tight text-ink">
          {title}
        </h1>
      </div>
      <div className={`flex min-w-0 flex-wrap items-center gap-2 ${actionsAlignment}`}>
        {actions}
      </div>
    </header>
  );
}

function MenuButton() {
  const navigation = useContext(NavigationContext);
  const { t } = useI18n();
  if (navigation === undefined) return null;
  return (
    <button
      aria-controls={navigation.drawerId}
      aria-expanded={navigation.open}
      aria-label={t.nav.openMenu}
      className="grid size-10 shrink-0 place-items-center rounded-lg border border-line bg-surface-raised text-ink-muted transition-colors hover:text-ink lg:hidden"
      onClick={navigation.show}
      type="button"
    >
      <Menu className="size-4" />
    </button>
  );
}
