import type { accessMessages as portuguese } from "../pt-BR/access";

export const accessMessages: typeof portuguese = {
  setup: {
    addToServer: "Add to a server",
    back: "Back",
    bot: "Bot",
    clientSecretLabel: "Client Secret",
    continue: "Continue",
    copyRedirect: "Copy redirect URL",
    discordHelp:
      "Developer Portal → your application → OAuth2 → Client Secret. It lets you connect the Discord account that owns the servers; you can also do it later under Installation.",
    discordLabel: "Owner account (optional)",
    discordTitle: "Prepare the owner connection",
    doneHelpAfter: ".",
    doneHelpBefore:
      "An AI profile still needs to be activated in the server — that is what enables",
    doneTitle: "Bot connected",
    failures: {
      invalid_discord_bot_token: "Discord rejected the token",
      invalid_setup_token:
        "The private setup link does not match. Open the URL printed by the launcher again.",
      request_failed: "Setup could not be completed. Try again in a moment.",
    },
    finish: "Finish",
    finishing: "Finishing…",
    goToDashboard: "Go to the dashboard",
    localModeHelp:
      "In local mode the dashboard only listens on 127.0.0.1 and asks for no password — that is why there is no password step here.",
    local: "Local",
    mode: "Mode",
    notConnected: "Not connected",
    online: "Online",
    passwordGood: (length: number) => `Good · ${String(length)} characters`,
    passwordHelp:
      "One password per installation — there are no user accounts. 15 to 128 characters; a long phrase beats scrambled symbols.",
    passwordLabel: "Installation password",
    passwordMinimum: "Minimum 15",
    passwordPlaceholder: "a phrase you will remember",
    passwordShort: (length: number) => `Short · ${String(length)} of 15`,
    passwordTitle: "Choose the password for this installation",
    public: "Public",
    publicConnectNotice:
      "When you come back from Discord, sign in with the installation password you just created.",
    redirectLabel: "Register this URL under OAuth2 → Redirects",
    skip: "Skip for now",
    skippedNotice:
      "Without the Client Secret no server can be configured. Save it later under Installation and connect the owner's account.",
    tokenHelp:
      "Developer Portal → your application → Bot → Reset Token. The Application ID is derived from it.",
    tokenLabel: "Bot token",
    tokenTitle: "Paste the bot token",
    validating: "Validating with Discord…",
  },
  unlock: {
    attempt: (count: number) => `Attempt ${String(count)}`,
    checking: "Checking…",
    goToDashboard: "Go to the dashboard",
    helpAfter: "on the host.",
    helpBefore: "Installation password, not a user password. Forgot it? Run",
    lockoutHelp:
      "Temporary lock on this address after repeated attempts. The installation keeps working normally.",
    passwordLabel: "Installation password",
    submit: "Sign in",
    title: "Unlock",
    unlocked: "Installation unlocked",
    verifyFailed: "Unable to verify the password",
    waitToRetry: "Wait before trying again",
    wrongPassword: "Wrong password",
  },
};
