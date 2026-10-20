"use client";

import Link from "next/link";
import { useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { useApi } from "@/lib/use-api";
import { CATEGORY_COLORS, CATEGORY_LABELS, formatMs, formatNumber, formatPercent } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { MetricCard } from "@/components/metric-card";
import { BarBreakdown, TrendChart } from "@/components/charts";
import { CategoryChip } from "@/components/category-chip";
import { StatusChip } from "@/components/status-chip";
import { InfoTip } from "@/components/info-tip";
import { Segmented } from "@/components/segmented";
import { ErrorState } from "@/components/error-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const RANGES = [
  { days: 1, label: "24 h" },
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 365, label: "1 year" }
];

export default function DashboardPage() {
  const [days, setDays] = useState(30);
  const [source, setSource] = useState<"api" | "evaluation">("api");
  const summary = useApi((client) => client.summary({ source, days }), [source, days]);
  const series = useApi((client) => client.timeseries({ source, days, bucket: days <= 1 ? "hour" : "day" }), [source, days]);
  const runs = useApi((client) => client.runs(), []);
  const recent = useApi((client) => client.queries({ limit: 8, source }), [source]);
  const readiness = useApi((client) => client.readiness(), []);

  const refresh = () => {
    summary.reload();
    series.reload();
    runs.reload();
    recent.reload();
    readiness.reload();
  };
  const s = summary.data;
  const points = series.data?.points ?? [];
  const completedRuns = (runs.data ?? []).filter((run) => run.status === "completed").slice().reverse();
  const runTrend = completedRuns.map((run) => ({
    run: `#${run.id}`,
    label: run.label,
    recall: run.summary.retrieval?.recall_at_k ?? null,
    precision: run.summary.retrieval?.precision_at_k ?? null,
    mrr: run.summary.retrieval?.mrr ?? null,
    faithfulness: run.summary.answer?.faithfulness ?? null
  }));
  const failures = (s?.failure_categories ?? []).filter((item) => item.count > 0);
  const loading = summary.loading || series.loading;

  return (
    <div>
      <PageHeader
        title="Overview"
        description="Usage, response time and answer quality across all questions."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Segmented value={source} onChange={setSource} options={[{ value: "api", label: "Live" }, { value: "evaluation", label: "Evaluations" }]} />
            <Segmented value={days} onChange={setDays} options={RANGES.map((range) => ({ value: range.days, label: range.label }))} />
            <Button variant="outline" onClick={refresh} disabled={loading} title="Refresh">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </Button>
          </div>
        }
      />

      {summary.error && <div className="mb-6"><ErrorState title="Couldn't load the overview" message={summary.error} /></div>}
      {readiness.data && !readiness.data.ready && (
        <div className="mb-6">
          <ErrorState
            title="Some services are unavailable"
            message={Object.entries(readiness.data.checks).filter(([, check]) => !check.ok).map(([name, check]) => `${name}: ${check.error ?? "failed"}`).join(" · ")}
          />
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        {s ? (
          <>
            <MetricCard label="Queries" term="total_queries" value={formatNumber(s.total_queries)} detail={`${s.answered} answered · ${s.no_answer} declined`} />
            <MetricCard label="Avg latency" term="latency" value={formatMs(s.avg_latency_ms)} detail={`p95 ${formatMs(s.p95_latency_ms)}`} tone={(s.p95_latency_ms ?? 0) > 15000 ? "warn" : "neutral"} />
            <MetricCard label="Error rate" term="error_rate" value={formatPercent(s.error_rate, 1)} detail={`${s.errors} failed requests`} tone={(s.error_rate ?? 0) > 0.05 ? "bad" : "good"} />
            <MetricCard label="Faithfulness" term="faithfulness" value={formatPercent(s.avg_faithfulness)} detail={`${s.evaluated} evaluated · ${s.pending_evaluations} pending`} tone={qualityTone(s.avg_faithfulness)} />
            <MetricCard label="Answer relevance" term="answer_relevance" value={formatPercent(s.avg_answer_relevance)} detail="Average over answered questions" tone={qualityTone(s.avg_answer_relevance)} />
            <MetricCard label="Tokens" term="tokens" value={formatNumber(s.total_tokens)} detail={`avg ${formatNumber(s.avg_tokens)} per query`} />
          </>
        ) : (
          Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className="h-[132px]" />)
        )}
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-2">
        <ChartCard title="Volume and latency" description="Queries per period (left axis) and average response time in ms (right axis)." term="latency">
          <TrendChart
            data={points}
            xKey="bucket"
            series={[
              { key: "queries", label: "Queries" },
              { key: "avg_latency_ms", label: "Avg latency (ms)", axis: "right", color: "#fcd34d" },
              { key: "p95_latency_ms", label: "p95 latency (ms)", axis: "right", color: "#fca5a5" }
            ]}
            emptyText="No queries in this period."
          />
        </ChartCard>
        <ChartCard title="Answer quality over time" description="Average faithfulness and answer relevance of evaluated answers." term="faithfulness">
          <TrendChart
            data={points}
            xKey="bucket"
            series={[
              { key: "avg_faithfulness", label: "Faithfulness", percent: true, color: "#6ee7b7" },
              { key: "avg_answer_relevance", label: "Answer relevance", percent: true, color: "#67e8f9" },
              { key: "error_rate", label: "Error rate", percent: true, color: "#f87171" }
            ]}
            emptyText="No evaluated answers in this period."
          />
        </ChartCard>
        <ChartCard title="Failure categories" description="Rule-based diagnosis of every trace. Live traffic diagnoses are suspected; evaluation runs are confirmed." term="confidence">
          <BarBreakdown
            data={failures.map((item) => ({ category: CATEGORY_LABELS[item.category], count: item.count }))}
            xKey="category"
            series={[{ key: "count", label: "Traces" }]}
            colors={failures.map((item) => CATEGORY_COLORS[item.category])}
            emptyText="No diagnosed traces yet."
          />
          {s && s.undiagnosed > 0 && (
            <div className="mt-3 text-xs text-zinc-500">
              {s.undiagnosed} older trace(s) were recorded before diagnosis existed; open one and use Re-evaluate to diagnose it.
            </div>
          )}
          {s && s.failure_subtypes.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {s.failure_subtypes.slice(0, 8).map((item) => (
                <Link key={item.key} href={`/history?category=${item.key.split(":")[0]}`} className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 text-xs text-zinc-300 hover:bg-white/[0.06]">
                  {item.key.split(":")[1].replaceAll("_", " ")} · {item.count}
                </Link>
              ))}
            </div>
          )}
        </ChartCard>
        <ChartCard title="Where the time goes" description="Average duration of each pipeline stage." term="stages">
          <BarBreakdown
            data={(s?.stage_latency ?? []).map((stage) => ({ stage: stage.label, ms: stage.avg_ms }))}
            xKey="stage"
            layout="vertical"
            series={[{ key: "ms", label: "Avg ms", color: "#67e8f9" }]}
            height={260}
            emptyText="No stage timings yet."
          />
        </ChartCard>
        <ChartCard title="Retrieval quality by evaluation run" description="Recall@K, Precision@K and MRR need ground truth, so they come from evaluation runs only." term="recall_at_k" wide>
          <TrendChart
            data={runTrend}
            xKey="run"
            series={[
              { key: "recall", label: "Recall@K", percent: true, color: "#67e8f9" },
              { key: "precision", label: "Precision@K", percent: true, color: "#c4b5fd" },
              { key: "mrr", label: "MRR", percent: true, color: "#fcd34d" },
              { key: "faithfulness", label: "Faithfulness", percent: true, color: "#6ee7b7" }
            ]}
            emptyText="No completed evaluation runs yet. Create one on the Evaluations page."
          />
        </ChartCard>
      </div>

      <Card className="mt-6">
        <CardHeader className="flex-row items-center justify-between">
          <div>
            <CardTitle>Recent questions</CardTitle>
            <CardDescription>Open one to see how it was answered.</CardDescription>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href="/history">View all</Link>
          </Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {(recent.data?.items ?? []).length === 0 ? (
            <div className="rounded-md border border-dashed border-white/10 p-6 text-center text-sm text-zinc-500">No questions yet. Try asking one on the Ask page.</div>
          ) : (
            recent.data?.items.map((item) => (
              <Link key={item.id} href={`/trace?id=${item.id}`} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-white/10 bg-white/[0.03] p-3 transition-colors hover:bg-white/[0.06]">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-white">{item.query}</div>
                  <div className="mt-1 text-xs text-zinc-500">trace {item.id} · {formatMs(item.latency_ms)} · faithfulness {formatPercent(item.faithfulness)}</div>
                </div>
                <div className="flex items-center gap-2">
                  <StatusChip status={item.status} />
                  <CategoryChip category={item.failure_category} confidence={item.confidence} />
                </div>
              </Link>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function qualityTone(value?: number | null) {
  if (value === null || value === undefined) return "neutral" as const;
  return value >= 0.8 ? ("good" as const) : value >= 0.6 ? ("warn" as const) : ("bad" as const);
}

function ChartCard({ title, description, term, wide, children }: { title: string; description: string; term?: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <Card className={wide ? "xl:col-span-2" : undefined}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {title}
          {term && <InfoTip term={term} />}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
