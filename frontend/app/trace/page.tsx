"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useState } from "react";
import { Search } from "lucide-react";
import { useApi } from "@/lib/use-api";
import { formatMs } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { TraceViewer } from "@/components/trace-viewer";
import { ErrorState } from "@/components/error-state";
import { CategoryChip } from "@/components/category-chip";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

export default function TracePage() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <TraceInspector />
    </Suspense>
  );
}

function TraceInspector() {
  const router = useRouter();
  const params = useSearchParams();
  const id = Number(params.get("id")) || null;
  const [input, setInput] = useState(id ? String(id) : "");

  const trace = useApi((client) => (id ? client.trace(id) : Promise.resolve(null)), [id], {
    pollMs: 2500,
    shouldPoll: (data) => data?.evaluation_status === "pending"
  });
  const recent = useApi((client) => client.queries({ limit: 12, source: "all" }), []);

  const open = (event: FormEvent) => {
    event.preventDefault();
    const next = Number(input);
    if (Number.isFinite(next) && next > 0) router.push(`/trace?id=${next}`);
  };

  return (
    <div>
      <PageHeader title="Traces" description="A step-by-step record of how a single question was answered." />
      <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Open trace</CardTitle>
              <CardDescription>Enter a trace (query log) ID.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={open} className="flex gap-2">
                <Input value={input} onChange={(event) => setInput(event.target.value)} inputMode="numeric" placeholder="Trace ID" />
                <Button type="submit" size="icon" title="Open trace">
                  <Search className="h-4 w-4" />
                </Button>
              </form>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Recent</CardTitle>
              <CardDescription>Latest traces, live and evaluation.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {(recent.data?.items ?? []).map((item) => (
                <Link
                  key={item.id}
                  href={`/trace?id=${item.id}`}
                  className={`block rounded-md border p-3 transition-colors hover:bg-white/[0.06] ${item.id === id ? "border-blue-400/40 bg-blue-400/5" : "border-white/10 bg-white/[0.03]"}`}
                >
                  <div className="truncate text-sm text-white">{item.query}</div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                    <span>#{item.id}</span>
                    <span>{formatMs(item.latency_ms)}</span>
                    <CategoryChip category={item.failure_category} confidence={item.confidence} />
                  </div>
                </Link>
              ))}
              {recent.data && recent.data.items.length === 0 && <div className="text-sm text-zinc-500">No traces yet.</div>}
            </CardContent>
          </Card>
        </div>
        <div>
          {trace.error && <div className="mb-4"><ErrorState title="Trace unavailable" message={trace.error} /></div>}
          {id && trace.loading && !trace.data ? <Skeleton className="h-96" /> : <TraceViewer trace={trace.data} onUpdate={(next) => trace.setData(next)} />}
        </div>
      </div>
    </div>
  );
}
