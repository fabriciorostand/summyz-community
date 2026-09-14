import { useEffect, useState } from "react";

import { api } from "../lib/api";

/**
 * The Discord authorization link is built by the backend from the bot's own token. Screens
 * that offer "add the bot to a server" read it here; an unconfigured bot yields no link.
 */
export function useBotInstallation(): { installUrl: string | undefined } {
  const [installUrl, setInstallUrl] = useState<string>();
  useEffect(() => {
    let active = true;
    void api.getBotInstallation().then(
      (bot) => {
        if (active) setInstallUrl(bot.configured ? bot.installUrl : undefined);
      },
      () => {
        if (active) setInstallUrl(undefined);
      },
    );
    return () => {
      active = false;
    };
  }, []);
  return { installUrl };
}
