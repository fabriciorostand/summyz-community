import { useEffect, useState } from "react";

import { ErrorState, LoadingPanel } from "../components/states";
import { RailLabel } from "../components/ui";
import { useI18n } from "../i18n/store";
import { TopBar } from "../layout/top-bar";
import { api, type CommandReference } from "../lib/api";
import { Screen } from "./screen";

/**
 * The bot registers these commands and the API describes them in English. The dashboard
 * translates what it knows and keeps the English text for anything newer than its dictionary.
 */
export function CommandsPage() {
  const { t } = useI18n();
  const [groups, setGroups] = useState<CommandReference>();
  const [loadError, setLoadError] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadToken is the explicit refetch trigger.
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
  }, [reloadToken]);

  return (
    <>
      <TopBar title={t.commands.title} />
      <Screen width="narrow">
        {loadError ? (
          <ErrorState
            onRetry={() => setReloadToken((token) => token + 1)}
            title={t.commands.unavailableTitle}
          >
            {t.commands.unavailableBody}
          </ErrorState>
        ) : groups === undefined ? (
          <LoadingPanel label={t.commands.loading} />
        ) : (
          groups.map((group) => (
            <div key={group.id}>
              <RailLabel>{t.commands.groups[group.id] ?? group.label}</RailLabel>
              <div className="overflow-hidden rounded-xl border border-line bg-surface">
                {group.commands.map(({ description, name }) => (
                  <div
                    className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-line-soft px-4 py-3 last:border-0"
                    key={name}
                  >
                    <code className="font-mono text-[12.5px] text-accent">{name}</code>
                    <span className="text-[12.5px] text-ink-muted">
                      {t.commands.descriptions[name] ?? description}
                    </span>
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
