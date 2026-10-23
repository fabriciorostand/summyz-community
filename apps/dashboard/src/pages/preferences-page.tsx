import { CalendarClock, Languages, SunMoon } from "lucide-react";
import { type ReactNode, useId } from "react";

import { Select } from "../components/select";
import { Card, SectionHeading, SelectField } from "../components/ui";
import {
  type DateFormatPreference,
  languageNames,
  languages,
  type TimeFormatPreference,
} from "../i18n/preferences";
import { setDateFormat, setLanguage, setTimeFormat, useI18n } from "../i18n/store";
import { useDashboard } from "../layout/dashboard-layout";
import { TopBar } from "../layout/top-bar";
import { Screen } from "./screen";

/**
 * Language, formats and theme belong to this browser: there is no account to attach them to.
 * Every select takes one column of the same two-column grid, so the four line up.
 */
export function PreferencesPage() {
  const { setTheme, theme } = useDashboard();
  const { dateFormatPreference, language, t, timeFormatPreference } = useI18n();
  const dateOptions: { label: string; value: DateFormatPreference }[] = [
    { label: t.preferences.automatic, value: "auto" },
    { label: "31/12/2026", value: "DD/MM/YYYY" },
    { label: "12/31/2026", value: "MM/DD/YYYY" },
    { label: "2026-12-31", value: "YYYY-MM-DD" },
  ];
  const timeOptions: { label: string; value: TimeFormatPreference }[] = [
    { label: t.preferences.automatic, value: "auto" },
    { label: "23:30", value: "24h" },
    { label: "11:30 PM", value: "12h" },
  ];
  return (
    <>
      <TopBar title={t.preferences.title} />
      <Screen width="narrow">
        <div className="flex flex-col gap-4">
          <PreferenceSection icon={<Languages className="size-4" />} title={t.preferences.language}>
            {(titleId) => (
              <SelectColumns>
                <Select
                  aria-labelledby={titleId}
                  onChange={setLanguage}
                  options={languages.map((value) => ({ label: languageNames[value], value }))}
                  value={language}
                />
              </SelectColumns>
            )}
          </PreferenceSection>
          <PreferenceSection icon={<SunMoon className="size-4" />} title={t.preferences.theme}>
            {(titleId) => (
              <SelectColumns>
                <Select
                  aria-labelledby={titleId}
                  onChange={setTheme}
                  options={[
                    { label: t.preferences.dark, value: "dark" },
                    { label: t.preferences.light, value: "light" },
                    { label: t.preferences.system, value: "system" },
                  ]}
                  value={theme}
                />
              </SelectColumns>
            )}
          </PreferenceSection>
          <PreferenceSection
            icon={<CalendarClock className="size-4" />}
            title={t.preferences.dateTime}
          >
            {() => (
              <SelectColumns>
                <SelectField
                  label={t.preferences.dateFormat}
                  onChange={setDateFormat}
                  options={dateOptions}
                  value={dateFormatPreference}
                />
                <SelectField
                  label={t.preferences.timeFormat}
                  onChange={setTimeFormat}
                  options={timeOptions}
                  value={timeFormatPreference}
                />
              </SelectColumns>
            )}
          </PreferenceSection>
        </div>
      </Screen>
    </>
  );
}

/** A section with a single control lets its heading name that control. */
function PreferenceSection({
  children,
  icon,
  title,
}: {
  children: (titleId: string) => ReactNode;
  icon: ReactNode;
  title: string;
}) {
  const titleId = useId();
  return (
    <Card aria-labelledby={titleId} role="region">
      <SectionHeading icon={icon} id={titleId} title={title} />
      {children(titleId)}
    </Card>
  );
}

/** A lone select keeps the width of one column instead of stretching across the card. */
function SelectColumns({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{children}</div>;
}
