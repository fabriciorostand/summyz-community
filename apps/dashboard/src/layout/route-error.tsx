import { useEffect } from "react";
import { useRouteError } from "react-router-dom";

import { ErrorState } from "../components/states";
import { useI18n } from "../i18n/store";
import { Screen } from "../pages/screen";
import { TopBar } from "./top-bar";

function reload() {
  window.location.reload();
}

/**
 * A screen that could not load, usually because the installation was updated while the
 * dashboard was open and the old code is gone. Reloading fetches the current version.
 * Inside the dashboard it replaces only the content, so the sidebar and the menu stay.
 */
export function RouteError({ placement }: { placement: "content" | "page" }) {
  const error = useRouteError();
  const { t } = useI18n();

  useEffect(() => {
    console.error("dashboard_route_failed", error);
  }, [error]);

  const state = (
    <ErrorState onRetry={reload} retryLabel={t.routeError.reload} title={t.routeError.title}>
      {t.routeError.body}
    </ErrorState>
  );
  if (placement === "page") {
    return (
      <div className="grid min-h-screen place-items-center bg-canvas p-6">
        <div className="w-full max-w-md">{state}</div>
      </div>
    );
  }
  return (
    <>
      <TopBar title={t.routeError.heading} />
      <Screen>{state}</Screen>
    </>
  );
}
