"use client";

import { useState } from "react";
import { Cpu, FileText, Loader2, RefreshCw, Sparkles } from "lucide-react";
import type { Diagnosis, QueryTrace, RetrievedChunk } from "@/lib/types";
import { useConsoleSettings } from "@/lib/settings";
import { cn, formatCost, formatDate, formatNumber, formatPercent } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/status-chip";
import { CategoryChip } from "@/components/category-chip";
import { StageWaterfall } from "@/components/stage-waterfall";
import { InfoTip } from "@/components/info-tip";
import { Segmented } from "@/components/segmented";

type Props = {
  trace: QueryTrace | null;
  compact?: boolean;
  onUpdate?: (trace: QueryTrace) => void;
};

export function TraceViewer({ trace, compact = false, onUpdate }: Props) {
  if (!trace) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex min-h-80 flex-col items-center justify-center p-8 text-center">
          <Cpu className="h-8 w-8 text-zinc-600" />
          <div className="mt-4 text-sm font-medium text-zinc-200">No trace selected</div>
          <div className="mt-2 max-w-sm text-sm leading-6 text-zinc-500">Run a query or open a trace from the history to inspect each stage of the pipeline.</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle>Trace {trace.query_log_id}</CardTitle>
              <CardDescription className="mt-1 break-all">
                {trace.trace_id} · {formatDate(trace.created_at)} · {trace.source}
              </CardDescription>
            </div>
            <StatusChip status={trace.status} />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <div className="text-xs uppercase tracking-[0.16em] text-zinc-500">Question</div>
            <p className="mt-1 text-sm text-white">{trace.original_query}</p>
          </div>
          {!compact && (
            <div>
              <div className="text-xs uppercase tracking-[0.16em] text-zinc-500">Answer returned</div>
              <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-zinc-200">{trace.answer ?? "—"}</p>
              {trace.raw_answer && trace.raw_answer !== trace.answer && (
                <details className="mt-2 rounded-md border border-amber-400/20 bg-amber-950/10 p-3 text-sm">
                  <summary className="cursor-pointer text-amber-100">The LLM wrote a different answer that the citation gate rejected</summary>
                  <p className="mt-2 whitespace-pre-wrap leading-6 text-zinc-300">{trace.raw_answer}</p>
                </details>
              )}
            </div>
          )}
          {trace.error_message && <div className="rounded-md border border-red-400/20 bg-red-950/20 p-3 text-sm text-red-100">{trace.error_message}</div>}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Meta label="Model" value={trace.model_usage.model} />
            <Meta label="Tokens" value={`${formatNumber(trace.model_usage.total_tokens)} (${formatNumber(trace.model_usage.prompt_tokens)} in / ${formatNumber(trace.model_usage.completion_tokens)} out)`} />
            <Meta label="Est. cost" value={formatCost(trace.model_usage.estimated_cost)} />
            <Meta label="Retrieval" value={`${trace.retrieval_mode ?? "n/a"} · top ${trace.top_k ?? "?"}`} />
          </div>
        </CardContent>
      </Card>

      <Section title="Stage timings" description="How long each step of answering took." term="stages">
        <StageWaterfall stages={trace.stages ?? []} totalMs={trace.latency_ms} evaluationStatus={trace.evaluation_status} />
      </Section>

      <DiagnosisPanel trace={trace} onUpdate={onUpdate} />
      <EvaluationPanel trace={trace} compact={compact} />
      <RetrievalPanel trace={trace} compact={compact} />

      {!compact && trace.context && (
        <Section title="Context sent to the LLM" description={`${trace.context.chunk_ids.length} chunk(s), ${formatNumber(trace.context.chars)} of ${formatNumber(trace.context.max_chars)} allowed characters.`}>
          {trace.context.dropped_chunk_ids.length > 0 && (
            <div className="mb-3 rounded-md border border-violet-400/20 bg-violet-950/20 p-3 text-sm text-violet-100">
              {trace.context.dropped_chunk_ids.length} retrieved chunk(s) did not fit and were left out: {trace.context.dropped_chunk_ids.join(", ")}
            </div>
          )}
          {trace.context.text ? (
            <details>
              <summary className="cursor-pointer text-sm text-cyan-200">Show the exact text</summary>
              <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap rounded-md border border-white/10 bg-zinc-950 p-3 text-xs leading-5 text-zinc-300">{trace.context.text}</pre>
            </details>
          ) : (
            <div className="text-sm text-zinc-500">This trace was recorded before the context text was stored.</div>
          )}
        </Section>
      )}
    </div>
  );
}

function DiagnosisPanel({ trace, onUpdate }: { trace: QueryTrace; onUpdate?: (trace: QueryTrace) => void }) {
  const { client } = useConsoleSettings();
  const [busy, setBusy] = useState<"explain" | "evaluate" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const diagnosis = (trace.diagnosis && "category" in trace.diagnosis ? trace.diagnosis : null) as Diagnosis | null;

  const run = async (action: "explain" | "evaluate") => {
    setBusy(action);
    setError(null);
    try {
      if (action === "explain") {
        const updated = await client.explain(trace.query_log_id);
        onUpdate?.({ ...trace, diagnosis: updated });
      } else {
        onUpdate?.(await client.reevaluate(trace.query_log_id));
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Request failed.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Section
      title="Diagnosis"
      description="Rule-based classification of what went wrong, if anything."
      term="confidence"
      action={
        <div className="flex gap-2">
          {trace.source !== "evaluation" && (
            <Button size="sm" variant="outline" onClick={() => run("evaluate")} disabled={busy !== null} title="Run evaluation and diagnosis again">
              {busy === "evaluate" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Re-evaluate
            </Button>
          )}
          <Button size="sm" variant="secondary" onClick={() => run("explain")} disabled={busy !== null || !diagnosis}>
            {busy === "explain" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Explain
          </Button>
        </div>
      }
    >
      {!diagnosis ? (
        <div className="text-sm text-zinc-500">This trace has not been diagnosed yet.</div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <CategoryChip category={diagnosis.category} confidence={diagnosis.confidence} />
            <Badge>{diagnosis.subtype.replaceAll("_", " ")}</Badge>
            <Badge>rule {diagnosis.rule}</Badge>
            <Badge>{diagnosis.ground_truth ? "with ground truth" : "no ground truth"}</Badge>
          </div>
          <p className="text-sm leading-6 text-zinc-200">{diagnosis.summary}</p>
          {diagnosis.reasons.length > 0 && (
            <ul className="list-disc space-y-1 pl-5 text-sm text-zinc-400">
              {diagnosis.reasons.map((reason) => <li key={reason}>{reason}</li>)}
            </ul>
          )}
          {diagnosis.recommendation && (
            <div className="rounded-md border border-cyan-300/15 bg-cyan-300/5 p-3 text-sm text-cyan-50">
              <span className="font-medium">What to try: </span>{diagnosis.recommendation}
            </div>
          )}
          {diagnosis.explanation && (
            <div className="rounded-md border border-white/10 bg-white/[0.03] p-3 text-sm leading-6 text-zinc-200">
              <div className="mb-1 text-xs uppercase tracking-[0.14em] text-zinc-500">Explanation ({diagnosis.explanation.method})</div>
              {diagnosis.explanation.text}
            </div>
          )}
        </div>
      )}
      {error && <div className="mt-3 text-sm text-red-200">{error}</div>}
    </Section>
  );
}

function EvaluationPanel({ trace, compact }: { trace: QueryTrace; compact: boolean }) {
  const evaluation = trace.evaluation ?? {};
  const quality = evaluation.answer_quality;
  const retrieval = evaluation.retrieval_quality;
  const truth = evaluation.ground_truth;

  return (
    <Section title="Evaluation" description={`Status: ${trace.evaluation_status}${quality ? ` · judge: ${quality.method}` : ""}`}>
      {trace.evaluation_status === "pending" && <div className="text-sm text-amber-200">Evaluation is running in the background; this panel refreshes automatically.</div>}
      {trace.evaluation_status === "skipped" && !quality && <div className="text-sm text-zinc-500">Not evaluated (failed requests and disabled evaluation are skipped).</div>}
      {evaluation.error && <div className="text-sm text-red-200">{evaluation.error}</div>}
      {quality && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Score label="Faithfulness" term="faithfulness" value={quality.faithfulness} />
            <Score label="Answer relevance" term="answer_relevance" value={quality.answer_relevance} />
            <Meta label="Contradiction" value={quality.contradiction ? "yes" : "no"} tone={quality.contradiction ? "bad" : undefined} />
          </div>
          {quality.skipped_reason && <div className="text-sm text-zinc-500">Answer-quality scores skipped: {quality.skipped_reason.replaceAll("_", " ")}.</div>}
          {quality.judge_error && <div className="text-sm text-amber-200">LLM judge failed, heuristic used instead: {quality.judge_error}</div>}
          {!compact && quality.claims && quality.claims.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs uppercase tracking-[0.14em] text-zinc-500">Claim-by-claim check</div>
              {quality.claims.map((claim, index) => (
                <div key={index} className="rounded-md border border-white/10 bg-white/[0.03] p-3 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-zinc-200">{claim.claim}</span>
                    <Badge className={cn("shrink-0", claim.verdict === "supported" ? "text-emerald-200" : claim.verdict === "contradicted" ? "text-red-200" : "text-amber-200")}>
                      {claim.verdict}{claim.source ? ` · ${claim.source}` : ""}
                    </Badge>
                  </div>
                  {claim.reason && <div className="mt-1 text-xs text-zinc-500">{claim.reason}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {retrieval && (
        <div className="mt-4">
          <div className="mb-2 text-xs uppercase tracking-[0.14em] text-zinc-500">Retrieval quality</div>
          {retrieval.available ? (
            <div className="grid gap-3 sm:grid-cols-4">
              <Score label={`Recall@${retrieval.k}`} term="recall_at_k" value={retrieval.recall_at_k} />
              <Score label={`Precision@${retrieval.k}`} term="precision_at_k" value={retrieval.precision_at_k} />
              <Score label="Reciprocal rank" term="mrr" value={retrieval.mrr} />
              <Meta label="Relevant found" value={`${retrieval.relevant_retrieved ?? 0} of ${retrieval.relevant_total ?? 0}`} />
            </div>
          ) : (
            <div className="rounded-md border border-dashed border-white/10 p-3 text-sm text-zinc-400">{retrieval.requires}</div>
          )}
        </div>
      )}
      {truth && (
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Meta label="Should answer" value={truth.should_answer ? "yes" : "no"} />
          <Meta label="Decision correct" value={truth.answer_decision_correct ? "yes" : "no"} tone={truth.answer_decision_correct ? undefined : "bad"} />
          <Meta label="Evidence in context" value={truth.evidence_in_context === null ? "not specified" : truth.evidence_in_context ? "yes" : "no"} />
        </div>
      )}
    </Section>
  );
}

function RetrievalPanel({ trace, compact }: { trace: QueryTrace; compact: boolean }) {
  const [view, setView] = useState<"final" | "vector" | "keyword">("final");
  const contextIds = new Set(trace.context?.chunk_ids ?? []);
  const droppedIds = new Set(trace.context?.dropped_chunk_ids ?? []);
  const relevantIds = new Set(trace.evaluation?.ground_truth?.relevant_chunk_ids ?? []);
  const chunks: RetrievedChunk[] =
    view === "vector" ? trace.vector_chunks ?? [] : view === "keyword" ? trace.keyword_chunks ?? [] : trace.retrieved_chunks ?? [];

  return (
    <Section
      title="Retrieved chunks"
      description={view === "final" ? "Chunks that passed the relevance thresholds, reranking and access control." : "Raw candidates before relevance gating."}
      action={
        !compact && (
          <Segmented
            value={view}
            onChange={setView}
            options={[
              { value: "final", label: `Final (${trace.retrieved_chunks?.length ?? 0})` },
              { value: "vector", label: `Vector (${trace.vector_chunks?.length ?? 0})` },
              { value: "keyword", label: `Keyword (${trace.keyword_chunks?.length ?? 0})` }
            ]}
          />
        )
      }
    >
      {chunks.length === 0 ? (
        <div className="rounded-md border border-white/10 bg-white/5 p-6 text-center text-sm text-zinc-500">No chunks.</div>
      ) : (
        <div className="space-y-3">
          {chunks.slice(0, compact ? 4 : 30).map((chunk, index) => (
            <div key={`${view}-${chunk.chunk_id}`} className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="text-xs tabular-nums text-zinc-500">#{index + 1}</span>
                  <FileText className="h-4 w-4 shrink-0 text-cyan-200" />
                  <span className="truncate text-sm font-medium text-white">{chunk.filename}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {relevantIds.has(chunk.chunk_id) && <Badge className="text-emerald-200">relevant (ground truth)</Badge>}
                  {view === "final" && contextIds.has(chunk.chunk_id) && <Badge className="text-cyan-100">in context</Badge>}
                  {view === "final" && droppedIds.has(chunk.chunk_id) && <Badge className="text-violet-200">dropped from context</Badge>}
                  <Badge>score {chunk.score.toFixed(3)}</Badge>
                  <Badge>{chunk.source}</Badge>
                </div>
              </div>
              <p className={cn("mt-3 text-sm leading-6 text-zinc-300", compact && "line-clamp-3")}>{chunk.snippet}</p>
              <div className="mt-2 flex flex-wrap gap-3 text-xs text-zinc-500">
                <span>chunk {chunk.chunk_id}</span>
                <span>document {chunk.document_id}</span>
                {chunk.page_start !== null && <span>page {chunk.page_start}{chunk.page_end && chunk.page_end !== chunk.page_start ? `–${chunk.page_end}` : ""}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

function Section({ title, description, term, action, children }: { title: string; description?: string; term?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2">
            {title}
            {term && <InfoTip term={term} />}
          </CardTitle>
          {description && <CardDescription className="mt-1">{description}</CardDescription>}
        </div>
        {action}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function Score({ label, value, term }: { label: string; value: number | null | undefined; term?: string }) {
  const tone = value === null || value === undefined ? "text-zinc-400" : value >= 0.8 ? "text-emerald-200" : value >= 0.5 ? "text-amber-200" : "text-red-200";
  return (
    <div className="rounded-md border border-white/10 bg-white/[0.03] p-3">
      <div className="flex items-center gap-1.5 text-xs uppercase tracking-[0.14em] text-zinc-500">
        {label}
        {term && <InfoTip term={term} />}
      </div>
      <div className={cn("mt-2 text-lg font-semibold tabular-nums", tone)}>{formatPercent(value)}</div>
    </div>
  );
}

function Meta({ label, value, tone }: { label: string; value: string; tone?: "bad" }) {
  return (
    <div className="rounded-md border border-white/10 bg-white/[0.03] p-3">
      <div className="text-xs uppercase tracking-[0.14em] text-zinc-500">{label}</div>
      <div className={cn("mt-2 truncate text-sm font-medium text-zinc-100", tone === "bad" && "text-red-200")} title={value}>{value}</div>
    </div>
  );
}

