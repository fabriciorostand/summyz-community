import { Card, SelectField } from "../components/ui";
import { useDashboard } from "../layout/dashboard-layout";
import { TopBar } from "../layout/top-bar";
import { Screen } from "./screen";

/** Language and theme are installation-wide: there is no account to attach them to. */
export function PreferencesPage() {
  const { setPreferences, settings, theme } = useDashboard();
  return (
    <>
      <TopBar title="Preferências" />
      <Screen width="narrow">
        <Card>
          <h2 className="m-0 mb-4 text-[15px] font-semibold tracking-tight text-ink">
            Idioma e tema
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField
              label="Idioma do dashboard"
              onChange={(event) =>
                setPreferences({
                  dashboardLanguage: event.currentTarget.value === "en" ? "en" : "pt-BR",
                  dashboardTheme: theme,
                })
              }
              value={settings.dashboardLanguage}
            >
              <option value="pt-BR">Português (Brasil)</option>
              <option value="en">English</option>
            </SelectField>
            <SelectField
              label="Tema"
              onChange={(event) => {
                const value = event.currentTarget.value;
                setPreferences({
                  dashboardLanguage: settings.dashboardLanguage,
                  dashboardTheme: value === "light" || value === "dark" ? value : "system",
                });
              }}
              value={theme}
            >
              <option value="dark">Escuro</option>
              <option value="light">Claro</option>
              <option value="system">Seguir o sistema</option>
            </SelectField>
          </div>
        </Card>
      </Screen>
    </>
  );
}
