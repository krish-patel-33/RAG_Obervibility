"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RagApiClient } from "@/lib/api";
import { useConsoleSettings } from "@/lib/settings";

/** Load data from the API, re-running when ``deps`` change. ``pollMs`` refreshes while ``shouldPoll`` holds. */
export function useApi<T>(
  load: (client: RagApiClient) => Promise<T>,
  deps: unknown[] = [],
  options: { pollMs?: number; shouldPoll?: (data: T | null) => boolean } = {}
) {
  const { client } = useConsoleSettings();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const loadRef = useRef(load);
  loadRef.current = load;
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const latestRequest = useRef(0);

  const reload = useCallback(async () => {
    // Only the newest request may update state: settings load after the first
    // render, so an older request to the default API URL can finish last.
    const requestId = ++latestRequest.current;
    setLoading(true);
    try {
      const result = await loadRef.current(client);
      if (requestId !== latestRequest.current) return;
      setData(result);
      setError(null);
    } catch (caught) {
      if (requestId !== latestRequest.current) return;
      setError(caught instanceof Error ? caught.message : "Request failed.");
    } finally {
      if (requestId === latestRequest.current) setLoading(false);
    }
  }, [client, ...deps]);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    const { pollMs, shouldPoll } = optionsRef.current;
    if (!pollMs || !shouldPoll?.(data)) return;
    const timer = window.setTimeout(reload, pollMs);
    return () => window.clearTimeout(timer);
  }, [data, reload]);

  return { data, error, loading, reload, setData };
}
