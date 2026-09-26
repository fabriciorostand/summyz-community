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
              onChange={(dashboardLanguage) =>
                setPreferences({ dashboardLanguage, dashboardTheme: theme })
              }
              options={[
                { label: "Português (Brasil)", value: "pt-BR" },
                { label: "English", value: "en" },
              ]}
              value={settings.dashboardLanguage}
            />
            <SelectField
              label="Tema"
              onChange={(dashboardTheme) =>
                setPreferences({ dashboardLanguage: settings.dashboardLanguage, dashboardTheme })
              }
              options={[
                { label: "Escuro", value: "dark" },
                { label: "Claro", value: "light" },
                { label: "Seguir o sistema", value: "system" },
              ]}
              value={theme}
            />
          </div>
        </Card>
      </Screen>
    </>
  );
}
