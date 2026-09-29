import { Card, SelectField } from "../components/ui";
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

/** Language, formats and theme belong to this browser: there is no account to attach them to. */
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
        <Card>
          <h2 className="m-0 mb-4 text-[15px] font-semibold tracking-tight text-ink">
            {t.preferences.card}
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <SelectField
              label={t.preferences.language}
              onChange={setLanguage}
              options={languages.map((value) => ({ label: languageNames[value], value }))}
              value={language}
            />
            <SelectField
              label={t.preferences.theme}
              onChange={setTheme}
              options={[
                { label: t.preferences.dark, value: "dark" },
                { label: t.preferences.light, value: "light" },
                { label: t.preferences.system, value: "system" },
              ]}
              value={theme}
            />
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
          </div>
        </Card>
      </Screen>
    </>
  );
}
