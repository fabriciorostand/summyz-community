import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { ApiError, api, type ModelCatalog } from "../lib/api";

type ModelPhase = ModelCatalog["phase"];
type CatalogProvider = ModelCatalog["provider"];

export type CatalogState =
  | { status: "idle" }
  | { status: "loading" }
  | { catalog: ModelCatalog; status: "ready" }
  | { code: string; status: "error" };

/* One request per catalog for the whole page; downloads and removals invalidate them all. */
const requests = new Map<string, Promise<ModelCatalog>>();
let generation = 0;
const listeners = new Set<() => void>();

export function invalidateModelCatalogs(): void {
  requests.clear();
  generation += 1;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function load(
  phase: ModelPhase,
  provider: CatalogProvider,
  family: string | undefined,
  device?: "auto" | "cpu" | "gpu",
) {
  const key = [phase, provider, family ?? "", device ?? ""].join("|");
  let request = requests.get(key);
  if (request === undefined) {
    request =
      device === undefined
        ? api.listModels(phase, provider, family)
        : api.listModels(phase, provider, family, device);
    requests.set(key, request);
    // A failed or unavailable read is not cached, so a retry asks the server again.
    request.then(
      (catalog) => {
        if (catalog.status === "unavailable") requests.delete(key);
      },
      () => requests.delete(key),
    );
  }
  return request;
}

export function useModelCatalog(
  phase: ModelPhase,
  provider: CatalogProvider | null,
  family?: string,
  device?: "auto" | "cpu" | "gpu",
): { reload: () => void; state: CatalogState } {
  const version = useSyncExternalStore(subscribe, () => generation);
  const [attempt, setAttempt] = useState(0);
  const shownKey = useRef<string | undefined>(undefined);
  const [state, setState] = useState<CatalogState>(
    provider === null ? { status: "idle" } : { status: "loading" },
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: version and attempt are the explicit refetch triggers.
  useEffect(() => {
    if (provider === null) {
      setState({ status: "idle" });
      return;
    }
    let current = true;
    // A refresh of the same catalog keeps showing it; another catalog shows the loading state.
    const key = [phase, provider, family ?? "", device ?? ""].join("|");
    const sameCatalog = shownKey.current === key;
    shownKey.current = key;
    setState((previous) =>
      sameCatalog && previous.status === "ready" ? previous : { status: "loading" },
    );
    load(phase, provider, family, device).then(
      (catalog) => {
        if (current) setState({ catalog, status: "ready" });
      },
      (error: unknown) => {
        if (current)
          setState({
            code: error instanceof ApiError ? error.code : "request_failed",
            status: "error",
          });
      },
    );
    return () => {
      current = false;
    };
  }, [phase, provider, family, device, version, attempt]);

  const reload = useCallback(() => setAttempt((value) => value + 1), []);
  return { reload, state };
}
