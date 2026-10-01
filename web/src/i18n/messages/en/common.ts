import type { commonMessages as portuguese } from "../pt-BR/common";

export const commonMessages: typeof portuguese = {
  common: {
    back: "Back",
    cancel: "Cancel",
    help: "Help",
    loading: "Loading…",
    retry: "Try again",
    tryAgain: "Try again",
  },
  app: {
    preparing: "Getting Summyz Community ready…",
    unreachableBody:
      "The dashboard could not reach the API. Recordings in progress are not affected.",
    unreachableTitle: "Unable to reach the server",
  },
  states: {
    addBack: "Add the bot",
    discordNotConnectedBody:
      "Configuring servers and profiles requires the owner's Discord account to be connected. Connect it under Installation.",
    discordNotConnectedTitle: "Owner account not connected",
    discordRateLimitedBody:
      "Discord asked the dashboard to slow down. Wait a few seconds and try again.",
    discordRateLimitedTitle: "Discord asked for a pause",
    guildRemovedBody:
      "needs the bot installed and must belong to the connected Discord account. Calls and settings stay saved.",
    guildRemovedThisServer: "This server",
    guildRemovedTitle: "This server cannot be configured",
    installBot: "Add the bot to a server",
    noServerBody:
      "Authorize the bot in a Discord server. It shows up here on its own, with nothing to register.",
    noServerTitle: "The bot is not in any server yet",
    sessionExpiredBody:
      "Sessions end after 7 days without use, or 30 days in total. Enter the installation password to continue.",
    sessionExpiredTitle: "Your session has expired",
    openInstallation: "Go to Installation",
    unlock: "Unlock",
    viewServers: "View servers",
  },
  discordConnect: {
    connect: "Connect Discord account",
    connecting: "Opening Discord…",
    failures: {
      discord_bot_not_configured: "Configure the bot token before connecting the account.",
      discord_client_secret_missing: "Save the application's Client Secret before connecting.",
      discord_rate_limited: "Discord asked for a pause. Try again in a few seconds.",
      request_failed: "Unable to open the Discord authorization. Try again.",
    },
  },
  nav: {
    calls: "Calls",
    closeMenu: "Close menu",
    commands: "Commands",
    configuration: "Configuration",
    installation: "Installation",
    meetings: "Meetings",
    navigation: "Navigation",
    openMenu: "Open navigation menu",
    overview: "Overview",
    preferences: "Preferences",
    profiles: "AI profiles",
    servers: "Servers",
    system: "System",
    tasks: "Tasks",
  },
  routeError: {
    body: "The dashboard may have been updated while it was open. Reload the page to continue.",
    heading: "Screen unavailable",
    reload: "Reload",
    title: "Unable to open this screen",
  },
  topBar: {
    guild: "Server",
    language: "Dashboard language",
    useDarkTheme: "Use dark theme",
    useLightTheme: "Use light theme",
  },
  pipeline: {
    completed: "Completed",
    failed: "Failed",
    inProgress: "In progress",
  },
  stages: {
    help: {
      refinement:
        "Reviews the transcript and fixes evident errors, without summarizing or translating.",
      summary: "Finds decisions and tasks and writes the summary published on Discord.",
      transcription: "Turns each participant's speech into text, with time and speaker.",
    },
    titles: {
      refinement: "Refinement",
      summary: "Summary",
      transcription: "Transcription",
    },
  },
};
