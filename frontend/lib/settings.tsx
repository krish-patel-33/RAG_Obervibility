"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { RagApiClient } from "@/lib/api";

export type ConsoleSettings = {
  apiBaseUrl: string;
  apiKey: string;
};

const defaultSettings: ConsoleSettings = {
  apiBaseUrl: process.env.NEXT_PUBLIC_RAG_API_BASE_URL || "",
  apiKey: process.env.NEXT_PUBLIC_RAG_API_KEY || ""
};

/** True when the deployment supplies the connection, so the UI never needs to show it. */
export const CONNECTION_PRECONFIGURED = Boolean(process.env.NEXT_PUBLIC_RAG_API_KEY);

type SettingsContextValue = {
  settings: ConsoleSettings;
  updateSettings: (next: Partial<ConsoleSettings>) => void;
  client: RagApiClient;
};

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<ConsoleSettings>(defaultSettings);

  useEffect(() => {
    const stored = window.localStorage.getItem("rag-console-settings");
    if (!stored || CONNECTION_PRECONFIGURED) return;
    try {
      const { apiBaseUrl, apiKey } = JSON.parse(stored) as Partial<ConsoleSettings>;
      setSettings({ apiBaseUrl: apiBaseUrl ?? defaultSettings.apiBaseUrl, apiKey: apiKey ?? defaultSettings.apiKey });
    } catch {
      window.localStorage.removeItem("rag-console-settings");
    }
  }, []);

  const updateSettings = (next: Partial<ConsoleSettings>) => {
    setSettings((current) => {
      const merged = { ...current, ...next };
      window.localStorage.setItem("rag-console-settings", JSON.stringify(merged));
      return merged;
    });
  };

  const client = useMemo(() => new RagApiClient({ baseUrl: settings.apiBaseUrl, apiKey: settings.apiKey }), [settings]);

  return <SettingsContext.Provider value={{ settings, updateSettings, client }}>{children}</SettingsContext.Provider>;
}

export function useConsoleSettings() {
  const value = useContext(SettingsContext);
  if (!value) throw new Error("useConsoleSettings must be used inside SettingsProvider");
  return value;
}
