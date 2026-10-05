import { useEffect } from "react";

import { useI18n } from "../i18n/store";
import { useDashboard } from "../layout/dashboard-layout";
import { TopBar } from "../layout/top-bar";
import { DiscordApplicationCard } from "./bot/application-card";
import { Screen } from "./screen";

/** The Discord application behind the bot; the owner's account lives in the sidebar. */
export function BotPage() {
  const { patchSettings, reloadSettings, settings } = useDashboard();
  const { t } = useI18n();

  // The shared snapshot may predate a save made on this screen, so the server decides.
  useEffect(() => {
    void reloadSettings();
  }, [reloadSettings]);

  return (
    <>
      <TopBar title={t.bot.title} />
      <Screen width="narrow">
        <DiscordApplicationCard
          applicationId={settings.discordApplicationId}
          clientSecretConfigured={settings.secrets.discordClientSecret}
          // The write succeeded, so reflect it right away and let the reload confirm it.
          onClientSecretChange={(configured) => {
            patchSettings({ secrets: { ...settings.secrets, discordClientSecret: configured } });
            void reloadSettings();
          }}
          onReplaced={reloadSettings}
          redirectUri={settings.discordRedirectUri}
          tokenConfigured={settings.secrets.discordBotToken}
        />
      </Screen>
    </>
  );
}
