import { useCallback, useEffect, useRef, useState } from "react";

import { api, type ModelDownload } from "../lib/api";

type LocalProvider = ModelDownload["provider"];
type ModelPhase = "transcription" | "refinement" | "summary";

const pollIntervalMs = 1_500;

export function isDownloadActive(job: ModelDownload): boolean {
  return job.status === "queued" || job.status === "downloading" || job.status === "cancelling";
}

export interface ModelDownloads {
  cancel: (downloadId: string) => Promise<void>;
  /** The running download of a model, or the one of this visit that failed. */
  jobFor: (provider: LocalProvider, model: string) => ModelDownload | undefined;
  listUnavailable: boolean;
  start: (phase: ModelPhase, provider: LocalProvider, model: string) => Promise<void>;
}

/**
 * Follows the server download queue while anything is transferring. Downloads that ended
 * before this visit stay out of the way; the ones followed here are reported once they end.
 */
export function useModelDownloads(onSettled: (job: ModelDownload) => void): ModelDownloads {
  const [jobs, setJobs] = useState<ModelDownload[]>([]);
  const [listUnavailable, setListUnavailable] = useState(false);
  const followed = useRef(new Set<string>());
  const reported = useRef(new Set<string>());
  const settled = useRef(onSettled);
  settled.current = onSettled;

  const refresh = useCallback(async () => {
    let next: ModelDownload[];
    try {
      next = await api.listModelDownloads();
    } catch {
      setListUnavailable(true);
      return;
    }
    setListUnavailable(false);
    for (const job of next) {
      if (isDownloadActive(job)) followed.current.add(job.downloadId);
      else if (followed.current.has(job.downloadId) && !reported.current.has(job.downloadId)) {
        reported.current.add(job.downloadId);
        settled.current(job);
      }
    }
    setJobs(next);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const polling = jobs.some(isDownloadActive);
  useEffect(() => {
    if (!polling) return;
    const timer = setInterval(() => void refresh(), pollIntervalMs);
    return () => clearInterval(timer);
  }, [polling, refresh]);

  const start = useCallback(async (phase: ModelPhase, provider: LocalProvider, model: string) => {
    const job = await api.startModelDownload(phase, provider, model);
    followed.current.add(job.downloadId);
    setJobs((current) => [job, ...current.filter((item) => item.downloadId !== job.downloadId)]);
  }, []);

  const cancel = useCallback(async (downloadId: string) => {
    await api.cancelModelDownload(downloadId);
    setJobs((current) =>
      current.map((job) =>
        job.downloadId === downloadId ? { ...job, status: "cancelling" as const } : job,
      ),
    );
  }, []);

  const jobFor = useCallback(
    (provider: LocalProvider, model: string) =>
      jobs.find(
        (job) =>
          job.provider === provider &&
          job.model === model &&
          (isDownloadActive(job) ||
            (job.status === "failed" && followed.current.has(job.downloadId))),
      ),
    [jobs],
  );

  return { cancel, jobFor, listUnavailable, start };
}
