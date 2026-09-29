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
    addBack: "Add it back",
    guildRemovedBody:
      "left the list because the bot was removed from it. Calls and settings stay in the database and come back if the bot is added again.",
    guildRemovedThisServer: "This server",
    guildRemovedTitle: "The bot is no longer in this server",
    installBot: "Add the bot to a server",
    noServerBody:
      "Authorize the bot in a Discord server. It shows up here on its own, with nothing to register.",
    noServerTitle: "The bot is not in any server yet",
    sessionExpiredBody:
      "Sessions end after 7 days without use, or 30 days in total. Enter the installation password to continue.",
    sessionExpiredTitle: "Your session has expired",
    unlock: "Unlock",
    viewServers: "View servers",
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
