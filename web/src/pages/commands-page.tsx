import { useEffect, useState } from "react";

import { ErrorState, LoadingPanel } from "../components/states";
import { RailLabel } from "../components/ui";
import { useDashboard } from "../layout/dashboard-layout";
import { TopBar } from "../layout/top-bar";
import { api, type CommandReference } from "../lib/api";
import { Screen } from "./screen";

/** The bot registers these commands; the API returns them localized in the dashboard language. */
export function CommandsPage() {
  const { settings } = useDashboard();
  const language = settings.dashboardLanguage;
  const [groups, setGroups] = useState<CommandReference>();
  const [loadError, setLoadError] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: language and reloadToken are the refetch triggers.
  useEffect(() => {
    let active = true;
    setGroups(undefined);
    setLoadError(false);
    void api
      .listCommands()
      .then((next) => {
        if (active) setGroups(next);
      })
      .catch(() => {
        if (active) setLoadError(true);
      });
    return () => {
      active = false;
    };
  }, [language, reloadToken]);

  return (
    <>
      <TopBar title="Comandos" />
      <Screen width="narrow">
        {loadError ? (
          <ErrorState
            onRetry={() => setReloadToken((token) => token + 1)}
            title="Comandos indisponíveis"
          >
            Não foi possível carregar a referência de comandos do bot. Tente novamente.
          </ErrorState>
        ) : groups === undefined ? (
          <LoadingPanel label="Carregando comandos…" />
        ) : (
          groups.map((group) => (
            <div key={group.label}>
              <RailLabel>{group.label}</RailLabel>
              <div className="overflow-hidden rounded-xl border border-line bg-surface">
                {group.commands.map(({ description, name }) => (
                  <div
                    className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-line-soft px-4 py-3 last:border-0"
                    key={name}
                  >
                    <code className="font-mono text-[12.5px] text-accent">{name}</code>
                    <span className="text-[12.5px] text-ink-muted">{description}</span>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </Screen>
    </>
  );
}
