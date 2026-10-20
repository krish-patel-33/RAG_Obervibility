import type { StageTiming } from "@/lib/types";
import { cn, formatMs } from "@/lib/utils";

const STAGE_COLORS: Record<string, string> = {
  query_embedding: "bg-cyan-300",
  document_retrieval: "bg-sky-300",
  reranking: "bg-indigo-300",
  access_control: "bg-zinc-400",
  context_construction: "bg-violet-300",
  llm_generation: "bg-emerald-300",
  citation_validation: "bg-amber-300",
  evaluation: "bg-pink-300"
};

/**
 * Waterfall of pipeline stages: each bar starts where the previous synchronous
 * stage ended. Evaluation runs after the response, so it is drawn separately.
 */
export function StageWaterfall({ stages, totalMs, evaluationStatus }: { stages: StageTiming[]; totalMs: number; evaluationStatus?: string }) {
  const sync = stages.filter((stage) => !stage.async);
  const background = stages.filter((stage) => stage.async);
  const span = Math.max(totalMs, sync.reduce((sum, stage) => sum + stage.ms, 0), 1);
  let offset = 0;

  return (
    <div className="space-y-2">
      {sync.map((stage) => {
        const left = (offset / span) * 100;
        const width = Math.max((stage.ms / span) * 100, 0.6);
        offset += stage.ms;
        return <StageRow key={stage.name} stage={stage} left={left} width={width} />;
      })}
      <div className="flex items-center justify-between border-t border-white/10 pt-2 text-sm">
        <span className="font-medium text-white">Total response time</span>
        <span className="tabular-nums text-white">{formatMs(totalMs)}</span>
      </div>
      {background.map((stage) => (
        <div key={stage.name} className="flex items-center justify-between rounded-md border border-dashed border-white/10 px-3 py-2 text-sm">
          <span className="text-zinc-300">{stage.label} <span className="text-xs text-zinc-500">(after the response)</span></span>
          <span className="tabular-nums text-zinc-200">{formatMs(stage.ms)}</span>
        </div>
      ))}
      {!background.length && evaluationStatus && (
        <div className="flex items-center justify-between rounded-md border border-dashed border-white/10 px-3 py-2 text-sm">
          <span className="text-zinc-300">Evaluation <span className="text-xs text-zinc-500">(after the response)</span></span>
          <span className="capitalize text-zinc-400">{evaluationStatus}</span>
        </div>
      )}
    </div>
  );
}

function StageRow({ stage, left, width }: { stage: StageTiming; left: number; width: number }) {
  return (
    <div className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)_4.5rem] items-center gap-3 text-sm">
      <span className={cn("truncate text-zinc-300", stage.status === "failed" && "text-red-200")}>{stage.label}</span>
      <div className="relative h-3 rounded-full bg-white/5">
        <div
          className={cn("absolute top-0 h-3 rounded-full", stage.status === "failed" ? "bg-red-400" : STAGE_COLORS[stage.name] ?? "bg-zinc-300")}
          style={{ left: `${left}%`, width: `${width}%` }}
        />
      </div>
      <span className="text-right tabular-nums text-zinc-200">{formatMs(stage.ms)}</span>
    </div>
  );
}
