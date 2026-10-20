"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { CONNECTION_PRECONFIGURED, useConsoleSettings } from "@/lib/settings";
import { useConsoleStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function SettingsPage() {
  const { clearSession } = useConsoleStore();
  const [cleared, setCleared] = useState(false);

  return (
    <div className="max-w-2xl">
      <PageHeader title="Settings" />
      <div className="space-y-6">
        {!CONNECTION_PRECONFIGURED && <ConnectionCard />}

        <Card>
          <CardHeader>
            <CardTitle>Browser data</CardTitle>
            <CardDescription>Clears the upload list and recent questions stored in this browser. Documents and history on the server are not affected.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              onClick={() => {
                clearSession();
                setCleared(true);
              }}
            >
              {cleared && <Check className="h-4 w-4" />}
              {cleared ? "Cleared" : "Clear browser data"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ConnectionCard() {
  const { settings, updateSettings } = useConsoleSettings();
  const [apiBaseUrl, setApiBaseUrl] = useState(settings.apiBaseUrl);
  const [apiKey, setApiKey] = useState(settings.apiKey);
  const [saved, setSaved] = useState(false);

  // Saved settings load from localStorage after the first render.
  useEffect(() => {
    setApiBaseUrl(settings.apiBaseUrl);
    setApiKey(settings.apiKey);
  }, [settings]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Access</CardTitle>
        <CardDescription>Enter the access key you were given to use this workspace.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            updateSettings({ apiBaseUrl: apiBaseUrl.trim(), apiKey: apiKey.trim() });
            setSaved(true);
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="api-key">Access key</Label>
            <Input
              id="api-key"
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(event) => {
                setApiKey(event.target.value);
                setSaved(false);
              }}
            />
          </div>
          <details className="group text-sm">
            <summary className="cursor-pointer select-none text-zinc-400 hover:text-zinc-200">Advanced</summary>
            <div className="mt-3 space-y-2">
              <Label htmlFor="api-url">Server address</Label>
              <Input
                id="api-url"
                value={apiBaseUrl}
                onChange={(event) => {
                  setApiBaseUrl(event.target.value);
                  setSaved(false);
                }}
                placeholder="Same as this site"
              />
            </div>
          </details>
          <Button type="submit">
            {saved && <Check className="h-4 w-4" />}
            {saved ? "Saved" : "Save"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
