"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useState } from "react";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { useApi } from "@/lib/use-api";
import { CATEGORY_LABELS, formatDate, formatMs, formatNumber, formatPercent } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { StatusChip } from "@/components/status-chip";
import { CategoryChip } from "@/components/category-chip";
import { ErrorState } from "@/components/error-state";
import { Segmented } from "@/components/segmented";
import { NativeSelect as Select } from "@/components/native-select";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

const PAGE_SIZE = 25;
const STATUSES = ["", "completed", "no_answer", "llm_failed", "failed"];
const CATEGORIES = ["", "failures", ...Object.keys(CATEGORY_LABELS)];

export default function HistoryPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <History />
    </Suspense>
  );
}

function History() {
  const router = useRouter();
  const params = useSearchParams();
  const [source, setSource] = useState<"api" | "evaluation" | "all">((params.get("source") as "api") || "api");
  const [status, setStatus] = useState(params.get("status") ?? "");
  const [category, setCategory] = useState(params.get("category") ?? "");
  const [searchInput, setSearchInput] = useState(params.get("search") ?? "");
  const [search, setSearch] = useState(searchInput);
  const [page, setPage] = useState(0);

  const list = useApi(
    (client) => client.queries({ limit: PAGE_SIZE, offset: page * PAGE_SIZE, source, status, category, search }),
    [source, status, category, search, page],
    { pollMs: 4000, shouldPoll: (data) => Boolean(data?.items.some((item) => item.evaluation_status === "pending")) }
  );
  const total = list.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    setPage(0);
    setSearch(searchInput.trim());
  };

  return (
    <div>
      <PageHeader title="History" description="Every question asked, with its outcome and quality scores. Open one to see how it was answered." />

      <Card className="mb-4">
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <Segmented
            value={source}
            onChange={(value) => {
              setSource(value);
              setPage(0);
            }}
            options={[
              { value: "api", label: "Live" },
              { value: "evaluation", label: "Evaluation" },
              { value: "all", label: "All" }
            ]}
          />
          <Select value={status} onChange={(value) => { setStatus(value); setPage(0); }} options={STATUSES} label="Status" format={(value) => value.replace("_", " ") || "Any status"} />
          <Select
            value={category}
            onChange={(value) => { setCategory(value); setPage(0); }}
            options={CATEGORIES}
            label="Diagnosis"
            format={(value) => (value === "failures" ? "Any failure" : CATEGORY_LABELS[value] ?? "Any diagnosis")}
          />
          <form onSubmit={submitSearch} className="ml-auto flex min-w-64 flex-1 gap-2 sm:flex-none">
            <Input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Search question or trace ID" />
            <Button type="submit" size="icon" variant="outline" title="Search">
              <Search className="h-4 w-4" />
            </Button>
          </form>
        </CardContent>
      </Card>

      {list.error && <div className="mb-4"><ErrorState title="Couldn't load history" message={list.error} /></div>}

      <Card>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[920px] text-sm">
            <thead className="border-b border-white/10 text-left text-xs text-zinc-500">
              <tr>
                <th className="px-4 py-3 font-medium">ID</th>
                <th className="px-4 py-3 font-medium">Question</th>
                <th className="px-4 py-3 font-medium">Outcome</th>
                <th className="px-4 py-3 text-right font-medium">Latency</th>
                <th className="px-4 py-3 text-right font-medium">Tokens</th>
                <th className="px-4 py-3 text-right font-medium">Faithful</th>
                <th className="px-4 py-3 font-medium">Diagnosis</th>
                <th className="px-4 py-3 font-medium">Time</th>
              </tr>
            </thead>
            <tbody>
              {list.loading && !list.data
                ? Array.from({ length: 6 }).map((_, index) => (
                    <tr key={index}>
                      <td colSpan={8} className="px-4 py-2"><Skeleton className="h-8" /></td>
                    </tr>
                  ))
                : list.data?.items.map((item) => (
                    <tr key={item.id} onClick={() => router.push(`/trace?id=${item.id}`)} className="cursor-pointer border-b border-white/5 transition-colors hover:bg-white/[0.04]">
                      <td className="px-4 py-3 tabular-nums text-zinc-400">
                        <Link href={`/trace?id=${item.id}`} onClick={(event) => event.stopPropagation()} className="hover:text-blue-300">{item.id}</Link>
                      </td>
                      <td className="max-w-md px-4 py-3">
                        <div className="truncate text-zinc-100">{item.query}</div>
                        {item.source !== "api" && <div className="text-xs text-zinc-500">{item.source}</div>}
                      </td>
                      <td className="px-4 py-3"><StatusChip status={item.status} /></td>
                      <td className="px-4 py-3 text-right tabular-nums text-zinc-300">{formatMs(item.latency_ms)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-zinc-300">{formatNumber(item.total_tokens)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-zinc-300">
                        {item.evaluation_status === "pending" ? <span className="text-amber-200">pending</span> : formatPercent(item.faithfulness)}
                      </td>
                      <td className="px-4 py-3"><CategoryChip category={item.failure_category} confidence={item.confidence} /></td>
                      <td className="px-4 py-3 whitespace-nowrap text-zinc-500">{formatDate(item.created_at)}</td>
                    </tr>
                  ))}
              {list.data && list.data.items.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-zinc-500">No requests match these filters.</td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <div className="mt-4 flex items-center justify-between text-sm text-zinc-500">
        <span>{total} request{total === 1 ? "" : "s"}</span>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
            <ChevronLeft className="h-4 w-4" /> Previous
          </Button>
          <span className="tabular-nums">{page + 1} / {pages}</span>
          <Button variant="outline" size="sm" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>
            Next <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
