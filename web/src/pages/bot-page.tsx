import { useInstallationSettings } from "../hooks/use-installation-settings";
import { useI18n } from "../i18n/store";
import { TopBar } from "../layout/top-bar";
import { DiscordApplicationCard } from "./bot/application-card";
import { Screen } from "./screen";

/** The Discord application behind the bot; the owner's account lives in the sidebar. */
export function BotPage() {
  const { reloadSettings, secretSaved, settings } = useInstallationSettings();
  const { t } = useI18n();

  return (
    <>
      <TopBar title={t.bot.title} />
      <Screen width="narrow">
        <DiscordApplicationCard
          applicationId={settings.discordApplicationId}
          clientSecretConfigured={settings.secrets.discordClientSecret}
          onClientSecretChange={secretSaved("discordClientSecret")}
          onReplaced={reloadSettings}
          redirectUri={settings.discordRedirectUri}
          tokenConfigured={settings.secrets.discordBotToken}
        />
      </Screen>
    </>
  );
}
