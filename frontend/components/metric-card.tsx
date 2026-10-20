import { Card, CardContent } from "@/components/ui/card";
import { InfoTip } from "@/components/info-tip";
import { cn } from "@/lib/utils";

export function MetricCard({
  label,
  value,
  detail,
  tone = "neutral",
  term
}: {
  label: string;
  value: string | number;
  detail: string;
  tone?: "neutral" | "good" | "warn" | "bad";
  term?: string;
}) {
  const tones = {
    neutral: "text-zinc-100",
    good: "text-emerald-200",
    warn: "text-amber-200",
    bad: "text-red-200"
  };
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center gap-2 text-sm text-zinc-400">
          {label}
          {term && <InfoTip term={term} />}
        </div>
        <div className={cn("mt-2 text-2xl font-semibold tracking-tight tabular-nums", tones[tone])}>{value}</div>
        <div className="mt-1 text-xs text-zinc-500">{detail}</div>
      </CardContent>
    </Card>
  );
}
