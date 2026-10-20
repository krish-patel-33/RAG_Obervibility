"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Database, FlaskConical, Loader2, Play, Upload } from "lucide-react";
import type { BenchmarkSection, EvalCaseInput, EvalRun, EvalRunCreate } from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { useConsoleSettings } from "@/lib/settings";
import { CATEGORY_LABELS, cn, formatDate, formatMs, formatNumber, formatPercent } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { BarBreakdown } from "@/components/charts";
import { CategoryChip } from "@/components/category-chip";
import { StatusChip } from "@/components/status-chip";
import { ErrorState } from "@/components/error-state";
import { InfoTip } from "@/components/info-tip";
import { NativeSelect } from "@/components/native-select";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

const TEMPLATE = `{"id": "q1", "question": "What minimum attendance must students maintain?", "expected_documents": ["attendance_policy.pdf"], "expected_evidence": ["minimum attendance of 75"], "reference_answer": "75 percent"}
{"id": "q2", "question": "Who won the 2018 football world cup?", "should_answer": false}`;

export default function EvaluationsPage() {
  const datasets = useApi((client) => client.datasets(), []);
  const runs = useApi((client) => client.runs(), [], {
    pollMs: 2500,
    shouldPoll: (data) => Boolean(data?.some((run) => run.status === "queued" || run.status === "running"))
  });
  const [selected, setSelected] = useState<number[]>([]);
  const [detailId, setDetailId] = useState<number | null>(null);

  const toggle = (id: number) => setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id].slice(-6)));

  return (
    <div>
      <PageHeader
        title="Evaluations"
        description="Measure retrieval quality, answer quality and system performance against questions with known answers, and compare configurations."
      />
      <MetricRequirements />
      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <DatasetPanel datasets={datasets.data ?? []} error={datasets.error} onCreated={datasets.reload} />
        <RunForm datasets={datasets.data ?? []} onStarted={runs.reload} />
      </div>
      <RunsTable runs={runs.data ?? []} error={runs.error} selected={selected} onToggle={toggle} onOpen={setDetailId} />
      {selected.length > 0 && <Comparison runIds={selected} />}
      {detailId !== null && <RunDetail runId={detailId} onClose={() => setDetailId(null)} />}
      <BenchmarkPanel />
    </div>
  );
}

function MetricRequirements() {
  const rows = [
    { group: "Retrieval quality", metrics: "Recall@K, Precision@K, MRR", needs: "Ground truth: which documents, pages or evidence phrases answer each question. Only available in evaluation runs.", terms: ["recall_at_k", "precision_at_k", "mrr"] },
    { group: "Answer quality", metrics: "Faithfulness, answer relevance", needs: "The answer and the context it was built from (always available). Correctness also needs a reference answer.", terms: ["faithfulness", "answer_relevance"] },
    { group: "System performance", metrics: "Latency, error rate, token usage", needs: "Only the trace itself; measured for every request.", terms: ["latency", "error_rate", "tokens"] }
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>What each metric needs</CardTitle>
        <CardDescription>Live traffic never reports retrieval metrics, because it has no ground truth to compare against.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 lg:grid-cols-3">
        {rows.map((row) => (
          <div key={row.group} className="rounded-md border border-white/10 bg-white/[0.03] p-4">
            <div className="text-sm font-medium text-white">{row.group}</div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-blue-200">
              {row.metrics}
              {row.terms.map((term) => <InfoTip key={term} term={term} />)}
            </div>
            <p className="mt-2 text-sm leading-6 text-zinc-400">{row.needs}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function parseCases(text: string): EvalCaseInput[] {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Paste or upload at least one case.");
  if (trimmed.startsWith("[") || (trimmed.startsWith("{") && trimmed.includes('"cases"'))) {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : parsed.cases;
  }
  return trimmed.split(/\r?\n/).filter((line) => line.trim()).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch {
      throw new Error(`Line ${index + 1} is not valid JSON.`);
    }
  });
}

function DatasetPanel({ datasets, error, onCreated }: { datasets: { id: number; name: string; case_count: number; created_at: string | null }[]; error: string | null; onCreated: () => void }) {
  const { client } = useConsoleSettings();
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "ok"; text: string } | null>(null);

  const create = async () => {
    setMessage(null);
    setBusy(true);
    try {
      const cases = parseCases(text);
      const dataset = await client.createDataset({ name: name.trim() || `Dataset ${new Date().toLocaleDateString()}`, cases });
      setMessage({ kind: "ok", text: `Created "${dataset.name}" with ${dataset.case_count} cases.` });
      setText("");
      setName("");
      onCreated();
    } catch (caught) {
      setMessage({ kind: "error", text: caught instanceof Error ? caught.message : "Could not create dataset." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Database className="h-4 w-4 text-blue-300" /> Datasets</CardTitle>
        <CardDescription>
          One JSON object per line (or a JSON array). Answerable cases name their <code>expected_documents</code>; <code>expected_evidence</code>, <code>expected_pages</code> and <code>reference_answer</code> are optional. Legacy <code>golden_qa</code> files work too.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <ErrorState title="Could not load datasets" message={error} />}
        <div className="max-h-40 space-y-2 overflow-y-auto">
          {datasets.length === 0 && <div className="text-sm text-zinc-500">No datasets yet.</div>}
          {datasets.map((dataset) => (
            <div key={dataset.id} className="flex items-center justify-between rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-sm">
              <span className="truncate text-white">#{dataset.id} {dataset.name}</span>
              <span className="shrink-0 text-xs text-zinc-500">{dataset.case_count} cases · {formatDate(dataset.created_at)}</span>
            </div>
          ))}
        </div>
        <div className="space-y-2">
          <Label htmlFor="dataset-name">New dataset name</Label>
          <Input id="dataset-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Course handbook QA" />
        </div>
        <Textarea value={text} onChange={(event) => setText(event.target.value)} placeholder={TEMPLATE} className="min-h-40 font-mono text-xs" />
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={create} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Create dataset</Button>
          <Button variant="outline" onClick={() => setText(TEMPLATE)}>Insert example</Button>
          <label className="cursor-pointer text-sm text-blue-300 hover:text-blue-200">
            Load .jsonl / .json file
            <input
              type="file"
              accept=".jsonl,.json,application/json"
              className="hidden"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                if (file) {
                  setText(await file.text());
                  if (!name) setName(file.name.replace(/\.(jsonl|json)$/i, ""));
                }
              }}
            />
          </label>
        </div>
        {message && <div className={cn("text-sm", message.kind === "error" ? "text-red-200" : "text-emerald-200")}>{message.text}</div>}
      </CardContent>
    </Card>
  );
}

function RunForm({ datasets, onStarted }: { datasets: { id: number; name: string }[]; onStarted: () => void }) {
  const { client } = useConsoleSettings();
  const [datasetId, setDatasetId] = useState("");
  const [label, setLabel] = useState("");
  const [mode, setMode] = useState<"hybrid" | "vector">("hybrid");
  const [topK, setTopK] = useState("6");
  const [rerank, setRerank] = useState(true);
  const [judge, setJudge] = useState<"auto" | "llm" | "heuristic">("auto");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chosen = datasetId || (datasets[0] ? String(datasets[0].id) : "");

  const start = async () => {
    if (!chosen) return;
    setBusy(true);
    setError(null);
    try {
      const payload: EvalRunCreate = { dataset_id: Number(chosen), retrieval_mode: mode, top_k: Number(topK) || undefined, reranking_enabled: rerank, judge };
      if (label.trim()) payload.label = label.trim();
      await client.createRun(payload);
      onStarted();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not start run.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><FlaskConical className="h-4 w-4 text-blue-300" /> New evaluation run</CardTitle>
        <CardDescription>Each run sends every question through the real pipeline with these settings and records them, so runs can be compared.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Dataset">
            <NativeSelect value={chosen} onChange={setDatasetId} label="Dataset" options={datasets.map((dataset) => String(dataset.id))} format={(value) => datasets.find((dataset) => String(dataset.id) === value)?.name ?? "No datasets"} />
          </Field>
          <Field label="Label (optional)">
            <Input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="e.g. hybrid k=6 baseline" />
          </Field>
          <Field label="Retrieval mode">
            <NativeSelect value={mode} onChange={(value) => setMode(value as "hybrid" | "vector")} label="Retrieval mode" options={["hybrid", "vector"]} format={(value) => (value === "hybrid" ? "Hybrid (vector + keyword)" : "Vector only")} />
          </Field>
          <Field label="Top-K">
            <Input type="number" min={1} max={20} value={topK} onChange={(event) => setTopK(event.target.value)} />
          </Field>
          <Field label="Answer judge">
            <NativeSelect
              value={judge}
              onChange={(value) => setJudge(value as "auto" | "llm" | "heuristic")}
              label="Judge"
              options={["auto", "llm", "heuristic"]}
              format={(value) => ({ auto: "Auto (LLM if configured)", llm: "LLM-as-judge", heuristic: "Heuristic (no API cost)" })[value] ?? value}
            />
          </Field>
          <Field label="Reranking">
            <div className="flex h-10 items-center gap-3">
              <Switch checked={rerank} onCheckedChange={setRerank} />
              <span className="text-sm text-zinc-400">{rerank ? "On" : "Off"}</span>
            </div>
          </Field>
        </div>
        <Button onClick={start} disabled={busy || !chosen}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Start run</Button>
        {!datasets.length && <div className="text-sm text-zinc-500">Create a dataset first.</div>}
        {error && <div className="text-sm text-red-200">{error}</div>}
      </CardContent>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function RunsTable({ runs, error, selected, onToggle, onOpen }: { runs: EvalRun[]; error: string | null; selected: number[]; onToggle: (id: number) => void; onOpen: (id: number) => void }) {
  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>Runs</CardTitle>
        <CardDescription>Tick runs to compare them side by side; open one for per-question results.</CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto p-0">
        {error && <div className="p-4"><ErrorState title="Could not load runs" message={error} /></div>}
        <table className="w-full min-w-[980px] text-sm">
          <thead className="border-b border-white/10 text-left text-xs text-zinc-500">
            <tr>
              <th className="px-4 py-3" />
              <th className="px-4 py-3 font-medium">Run</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 text-right font-medium">Recall@K</th>
              <th className="px-4 py-3 text-right font-medium">Precision@K</th>
              <th className="px-4 py-3 text-right font-medium">MRR</th>
              <th className="px-4 py-3 text-right font-medium">Faithful</th>
              <th className="px-4 py-3 text-right font-medium">Relevance</th>
              <th className="px-4 py-3 text-right font-medium">Avg latency</th>
              <th className="px-4 py-3 text-right font-medium">Errors</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {runs.length === 0 && (
              <tr><td colSpan={11} className="px-4 py-8 text-center text-zinc-500">No runs yet.</td></tr>
            )}
            {runs.map((run) => {
              const s = run.summary;
              const busy = run.status === "queued" || run.status === "running";
              return (
                <tr key={run.id} className="border-b border-white/5">
                  <td className="px-4 py-3">
                    <input type="checkbox" aria-label={`Compare run ${run.id}`} checked={selected.includes(run.id)} onChange={() => onToggle(run.id)} disabled={run.status !== "completed"} className="h-4 w-4 accent-blue-400" />
                  </td>
                  <td className="max-w-xs px-4 py-3">
                    <div className="truncate text-white">#{run.id} {run.label}</div>
                    <div className="text-xs text-zinc-500">{formatDate(run.created_at)} · judge {String(run.config.judge)} · {String(run.config.chat_model)}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-200" />}
                      <StatusChip status={run.status} />
                      {busy && <span className="text-xs text-zinc-500">{run.completed_count}/{run.case_count}</span>}
                    </div>
                    {run.error_message && <div className="mt-1 max-w-xs truncate text-xs text-red-200" title={run.error_message}>{run.error_message}</div>}
                  </td>
                  <Num value={formatPercent(s.retrieval?.recall_at_k)} />
                  <Num value={formatPercent(s.retrieval?.precision_at_k)} />
                  <Num value={s.retrieval?.mrr?.toFixed(2) ?? "n/a"} />
                  <Num value={formatPercent(s.answer?.faithfulness)} />
                  <Num value={formatPercent(s.answer?.answer_relevance)} />
                  <Num value={formatMs(s.system?.avg_latency_ms)} />
                  <Num value={formatPercent(s.system?.error_rate)} />
                  <td className="px-4 py-3 text-right">
                    <Button size="sm" variant="outline" onClick={() => onOpen(run.id)}>Details</Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function Num({ value }: { value: string }) {
  return <td className="px-4 py-3 text-right tabular-nums text-zinc-200">{value}</td>;
}

const COMPARE_METRICS = [
  { key: "recall", label: "Recall@K", get: (run: EvalRun) => run.summary.retrieval?.recall_at_k },
  { key: "precision", label: "Precision@K", get: (run: EvalRun) => run.summary.retrieval?.precision_at_k },
  { key: "mrr", label: "MRR", get: (run: EvalRun) => run.summary.retrieval?.mrr },
  { key: "faithfulness", label: "Faithfulness", get: (run: EvalRun) => run.summary.answer?.faithfulness },
  { key: "relevance", label: "Relevance", get: (run: EvalRun) => run.summary.answer?.answer_relevance },
  { key: "decision", label: "Answer/decline accuracy", get: (run: EvalRun) => run.summary.answer?.answer_decision_accuracy }
];

function Comparison({ runIds }: { runIds: number[] }) {
  const comparison = useApi((client) => client.compare(runIds), [runIds.join(",")]);
  const runs = comparison.data?.runs ?? [];
  const chartData = COMPARE_METRICS.map((metric) => ({
    metric: metric.label,
    ...Object.fromEntries(runs.map((run) => [`run${run.id}`, metric.get(run) ?? null]))
  }));
  const configKeys = ["retrieval_mode", "top_k", "reranking_enabled", "judge", "chat_model", "embedding_model", "min_vector_similarity", "max_context_chars"];

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>Comparison</CardTitle>
        <CardDescription>Quality metrics per run, the settings that differ, and how each question was diagnosed in each run.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {comparison.error && <ErrorState title="Comparison failed" message={comparison.error} />}
        <BarBreakdown data={chartData} xKey="metric" series={runs.map((run) => ({ key: `run${run.id}`, label: `#${run.id} ${run.label}`, percent: true }))} height={280} />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-left text-xs text-zinc-500">
              <tr>
                <th className="py-2 pr-4 font-medium">Setting / metric</th>
                {runs.map((run) => <th key={run.id} className="py-2 pr-4 font-medium">#{run.id}</th>)}
              </tr>
            </thead>
            <tbody>
              {configKeys.map((key) => {
                const values = runs.map((run) => String(run.config[key] ?? "n/a"));
                const differs = new Set(values).size > 1;
                return (
                  <tr key={key} className="border-t border-white/5">
                    <td className="py-2 pr-4 text-zinc-400">{key.replaceAll("_", " ")}</td>
                    {values.map((value, index) => <td key={index} className={cn("py-2 pr-4", differs ? "font-medium text-blue-200" : "text-zinc-300")}>{value}</td>)}
                  </tr>
                );
              })}
              <tr className="border-t border-white/5">
                <td className="py-2 pr-4 text-zinc-400">p95 latency</td>
                {runs.map((run) => <td key={run.id} className="py-2 pr-4 tabular-nums text-zinc-300">{formatMs(run.summary.system?.p95_latency_ms)}</td>)}
              </tr>
              <tr className="border-t border-white/5">
                <td className="py-2 pr-4 text-zinc-400">tokens (answer + judge)</td>
                {runs.map((run) => <td key={run.id} className="py-2 pr-4 tabular-nums text-zinc-300">{formatNumber(run.summary.system?.total_tokens)} + {formatNumber(run.summary.system?.judge_tokens)}</td>)}
              </tr>
              {Object.keys(CATEGORY_LABELS).map((category) => (
                <tr key={category} className="border-t border-white/5">
                  <td className="py-2 pr-4 text-zinc-400">{CATEGORY_LABELS[category]}</td>
                  {runs.map((run) => <td key={run.id} className="py-2 pr-4 tabular-nums text-zinc-300">{run.summary.failure_categories?.[category as keyof typeof run.summary.failure_categories] ?? 0}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {comparison.data && comparison.data.cases.length > 0 && (
          <div className="overflow-x-auto">
            <div className="mb-2 text-xs text-zinc-500">Per-question diagnosis</div>
            <table className="w-full min-w-[640px] text-sm">
              <tbody>
                {comparison.data.cases.map((item) => (
                  <tr key={item.case_id} className="border-t border-white/5">
                    <td className="max-w-sm truncate py-2 pr-4 text-zinc-200" title={item.question}>{item.question}</td>
                    {runs.map((run) => {
                      const cell = item.runs[String(run.id)];
                      return <td key={run.id} className="py-2 pr-4">{cell ? <CategoryChip category={cell.failure_category} confidence="confirmed" /> : <span className="text-zinc-600">—</span>}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RunDetail({ runId, onClose }: { runId: number; onClose: () => void }) {
  const run = useApi((client) => client.run(runId), [runId], {
    pollMs: 2500,
    shouldPoll: (data) => data?.status === "queued" || data?.status === "running"
  });
  const data = run.data;
  return (
    <Card className="mt-6">
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle>Run #{runId} {data?.label}</CardTitle>
          <CardDescription>Per-question metrics and confirmed diagnosis. Open a trace to see exactly what happened.</CardDescription>
        </div>
        <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>
      </CardHeader>
      <CardContent className="overflow-x-auto p-0">
        {run.error && <div className="p-4"><ErrorState title="Could not load run" message={run.error} /></div>}
        <table className="w-full min-w-[900px] text-sm">
          <thead className="border-b border-white/10 text-left text-xs text-zinc-500">
            <tr>
              <th className="px-4 py-3 font-medium">Question</th>
              <th className="px-4 py-3 text-right font-medium">Recall</th>
              <th className="px-4 py-3 text-right font-medium">RR</th>
              <th className="px-4 py-3 text-right font-medium">Faithful</th>
              <th className="px-4 py-3 text-right font-medium">Relevance</th>
              <th className="px-4 py-3 font-medium">Diagnosis</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {data?.results.map((result) => (
              <tr key={result.id} className="border-b border-white/5 align-top">
                <td className="max-w-md px-4 py-3">
                  <div className="text-zinc-100">{result.question}</div>
                  <div className="mt-1 text-xs text-zinc-500">
                    {result.should_answer ? `expects ${result.expected_documents.join(", ")}` : "should be declined"} · {formatMs(result.latency_ms)}
                  </div>
                  {result.diagnosis?.summary && <div className="mt-1 text-xs text-zinc-400">{result.diagnosis.summary}</div>}
                </td>
                <Num value={formatPercent(result.retrieval_quality?.recall_at_k)} />
                <Num value={result.retrieval_quality?.mrr?.toFixed(2) ?? "n/a"} />
                <Num value={formatPercent(result.answer_quality?.faithfulness)} />
                <Num value={formatPercent(result.answer_quality?.answer_relevance)} />
                <td className="px-4 py-3">
                  <CategoryChip category={result.failure_category} confidence="confirmed" />
                  {result.diagnosis?.rule && <div className="mt-1 text-xs text-zinc-500">{result.diagnosis.subtype?.replaceAll("_", " ")} · {result.diagnosis.rule}</div>}
                </td>
                <td className="px-4 py-3 text-right">
                  {result.query_log_id && <Link href={`/trace?id=${result.query_log_id}`} className="text-blue-300 hover:text-blue-200">Trace →</Link>}
                </td>
              </tr>
            ))}
            {data && data.results.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-zinc-500">{data.status === "completed" ? "No results." : "Run in progress…"}</td></tr>
            )}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function BenchmarkPanel() {
  const report = useApi((client) => client.benchmark(), []);
  const data = report.data;
  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>How accurate is the diagnosis?</CardTitle>
        <CardDescription>
          The rule-based diagnosis is tested on labelled scenarios with one injected fault each (missing document, retriever miss, dropped context, cut evidence, contradicting / refusing / uncited / hallucinating LLM) plus healthy controls.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {report.error && <ErrorState title="Could not load benchmark" message={report.error} />}
        {data && !data.available && (
          <div className="text-sm text-zinc-400">
            No report yet. Run <code className="rounded bg-white/10 px-1.5 py-0.5">{data.command}</code> in the backend folder.
          </div>
        )}
        {data && data.available && (
          <div className="grid gap-6 lg:grid-cols-2">
            <BenchmarkMatrix title="With ground truth" subtitle="As used in evaluation runs" section={data} count={data.scenario_count} />
            <BenchmarkMatrix title="Without ground truth" subtitle="As used for live traffic, on the same traces" section={data.without_ground_truth} count={data.scenario_count} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function BenchmarkMatrix({ title, subtitle, section, count }: { title: string; subtitle: string; section: BenchmarkSection; count: number }) {
  const labels = useMemo(() => section.labels, [section.labels]);
  return (
    <div className="rounded-md border border-white/10 bg-white/[0.02] p-4">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-white">{title}</div>
          <div className="text-xs text-zinc-500">{subtitle} · {count} scenarios</div>
        </div>
        <div className="text-2xl font-semibold tabular-nums text-white">{formatPercent(section.accuracy, 1)}</div>
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-zinc-500">
              <th className="py-1 pr-2 text-left font-medium">actual ↓ / diagnosed →</th>
              {labels.map((label) => <th key={label} className="px-1 py-1 text-right font-medium">{CATEGORY_LABELS[label]}</th>)}
            </tr>
          </thead>
          <tbody>
            {labels.map((expected) => (
              <tr key={expected} className="border-t border-white/5">
                <td className="py-1.5 pr-2 text-zinc-300">{CATEGORY_LABELS[expected]}</td>
                {labels.map((predicted) => {
                  const value = section.confusion_matrix[expected]?.[predicted] ?? 0;
                  return (
                    <td key={predicted} className={cn("px-1 py-1.5 text-right tabular-nums", value === 0 ? "text-zinc-600" : expected === predicted ? "font-semibold text-emerald-200" : "text-red-200")}>
                      {value}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {Object.entries(section.per_class).map(([label, stats]) => (
          <Badge key={label}>{CATEGORY_LABELS[label]} F1 {stats.f1.toFixed(2)}</Badge>
        ))}
      </div>
    </div>
  );
}
