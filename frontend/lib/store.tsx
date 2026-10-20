"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { StoredJob, StoredQuery } from "@/lib/types";

// Browser-session conveniences only (recent uploads and chat turns).
// Metrics, history and evaluation results come from the backend.
type ConsoleStore = {
  jobs: StoredJob[];
  queries: StoredQuery[];
  upsertJob: (job: StoredJob) => void;
  addQuery: (query: StoredQuery) => void;
  clearSession: () => void;
};

const StoreContext = createContext<ConsoleStore | null>(null);

function readStored<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(window.localStorage.getItem(key) || "null") ?? fallback;
  } catch {
    return fallback;
  }
}

function writeStored(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be unavailable (private mode, quota); the session still works.
  }
}

export function ConsoleStoreProvider({ children }: { children: React.ReactNode }) {
  const [jobs, setJobs] = useState<StoredJob[]>([]);
  const [queries, setQueries] = useState<StoredQuery[]>([]);

  useEffect(() => {
    setJobs(readStored("rag-console-jobs", []));
    setQueries(readStored("rag-console-queries", []));
  }, []);

  useEffect(() => writeStored("rag-console-jobs", jobs.slice(0, 50)), [jobs]);
  useEffect(() => writeStored("rag-console-queries", queries.slice(0, 50)), [queries]);

  const value = useMemo<ConsoleStore>(
    () => ({
      jobs,
      queries,
      upsertJob: (job) => {
        setJobs((current) => {
          const exists = current.some((item) => item.job_id === job.job_id);
          const next = exists ? current.map((item) => (item.job_id === job.job_id ? { ...item, ...job } : item)) : [job, ...current];
          return next.slice(0, 50);
        });
      },
      addQuery: (query) => setQueries((current) => [query, ...current].slice(0, 50)),
      clearSession: () => {
        setJobs([]);
        setQueries([]);
      }
    }),
    [jobs, queries]
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useConsoleStore() {
  const value = useContext(StoreContext);
  if (!value) throw new Error("useConsoleStore must be used inside ConsoleStoreProvider");
  return value;
}
