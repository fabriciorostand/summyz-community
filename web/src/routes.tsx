import type { ComponentType } from "react";
import { Navigate, Outlet, type RouteObject, useOutletContext } from "react-router-dom";

import { App, AuthenticatedArea, useAccess } from "./app";
import { FullPageLoading } from "./components/states";
import { RouteError } from "./layout/route-error";

/**
 * Each screen is its own chunk, fetched on the first visit. The router keeps the current screen
 * on display while the next one loads, so the progress bar is the only sign of the wait.
 */
function screen(load: () => Promise<ComponentType>): Pick<RouteObject, "lazy"> {
  return { lazy: async () => ({ Component: await load() }) };
}

/** Passes the dashboard context through, so the error boundary sits between layout and pages. */
function DashboardScreens() {
  return <Outlet context={useOutletContext()} />;
}

export const routes: RouteObject[] = [
  {
    children: [
      {
        path: "setup",
        ...screen(async () => {
          const { SetupPage } = await import("./pages/setup-page");
          return function SetupRoute() {
            const { accessMode, refresh } = useAccess();
            return <SetupPage accessMode={accessMode} onComplete={refresh} />;
          };
        }),
      },
      {
        path: "login",
        ...screen(async () => {
          const { UnlockPage } = await import("./pages/unlock-page");
          return function UnlockRoute() {
            return <UnlockPage onUnlocked={useAccess().refresh} />;
          };
        }),
      },
      {
        children: [
          {
            children: [
              {
                index: true,
                ...screen(async () => (await import("./pages/overview-page")).OverviewPage),
              },
              {
                path: "history",
                ...screen(async () => (await import("./pages/calls-page")).CallsPage),
              },
              {
                path: "history/:meetingId",
                ...screen(async () => (await import("./pages/call-detail-page")).CallDetailPage),
              },
              {
                path: "tasks",
                ...screen(async () => (await import("./pages/tasks-page")).TasksPage),
              },
              {
                path: "servers",
                ...screen(async () => (await import("./pages/servers-page")).ServersPage),
              },
              {
                path: "guilds/:guildId",
                ...screen(async () => (await import("./pages/guild-page")).GuildPage),
              },
              {
                path: "profiles",
                ...screen(
                  async () => (await import("./pages/profiles/profiles-page")).ProfilesPage,
                ),
              },
              {
                path: "commands",
                ...screen(async () => (await import("./pages/commands-page")).CommandsPage),
              },
              {
                path: "settings",
                ...screen(async () => (await import("./pages/preferences-page")).PreferencesPage),
              },
              {
                path: "bot",
                ...screen(async () => (await import("./pages/bot-page")).BotPage),
              },
              {
                path: "installation",
                ...screen(async () => (await import("./pages/installation-page")).InstallationPage),
              },
            ],
            element: <DashboardScreens />,
            errorElement: <RouteError placement="content" />,
          },
        ],
        element: <AuthenticatedArea />,
      },
      { element: <Navigate replace to="/" />, path: "*" },
    ],
    element: <App />,
    errorElement: <RouteError placement="page" />,
    hydrateFallbackElement: <FullPageLoading />,
  },
];
