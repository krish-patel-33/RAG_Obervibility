"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

export const SERIES_COLORS = ["#67e8f9", "#6ee7b7", "#fcd34d", "#c4b5fd", "#fca5a5", "#93c5fd"];

const axis = { stroke: "#52525b", fontSize: 12, tickLine: false, axisLine: false } as const;
const tooltipStyle = {
  contentStyle: { background: "#18181b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 12 },
  labelStyle: { color: "#e4e4e7" },
  itemStyle: { color: "#d4d4d8" }
};

export type Series = { key: string; label: string; color?: string; percent?: boolean; axis?: "left" | "right" };

type Row = Record<string, unknown>;

function formatValue(value: unknown, percent?: boolean) {
  if (typeof value !== "number") return String(value ?? "n/a");
  return percent ? `${Math.round(value * 100)}%` : value.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

export function EmptyChart({ text, height = 240 }: { text: string; height?: number }) {
  return (
    <div style={{ height }} className="flex items-center justify-center rounded-md border border-dashed border-white/10 text-center text-sm text-zinc-500">
      {text}
    </div>
  );
}

export function TrendChart({
  data,
  xKey,
  series,
  height = 240,
  emptyText = "No data yet."
}: {
  data: Row[];
  xKey: string;
  series: Series[];
  height?: number;
  emptyText?: string;
}) {
  if (!data.length) return <EmptyChart text={emptyText} height={height} />;
  const hasRight = series.some((item) => item.axis === "right");
  const leftPercent = series.filter((item) => item.axis !== "right").every((item) => item.percent);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: hasRight ? 0 : 12, left: -12, bottom: 0 }}>
        <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
        <XAxis dataKey={xKey} {...axis} minTickGap={24} />
        <YAxis yAxisId="left" {...axis} domain={leftPercent ? [0, 1] : ["auto", "auto"]} tickFormatter={(value) => formatValue(value, leftPercent)} />
        {hasRight && <YAxis yAxisId="right" orientation="right" {...axis} />}
        <Tooltip
          {...tooltipStyle}
          formatter={(value, name) => {
            const item = series.find((entry) => entry.label === name);
            return [formatValue(value, item?.percent), name];
          }}
        />
        <Legend wrapperStyle={{ fontSize: 12, color: "#a1a1aa" }} />
        {series.map((item, index) => (
          <Line
            key={item.key}
            yAxisId={item.axis ?? "left"}
            type="monotone"
            dataKey={item.key}
            name={item.label}
            stroke={item.color ?? SERIES_COLORS[index % SERIES_COLORS.length]}
            strokeWidth={2}
            dot={data.length < 20}
            connectNulls
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

export function BarBreakdown({
  data,
  xKey,
  series,
  height = 240,
  layout = "horizontal",
  colors,
  emptyText = "No data yet."
}: {
  data: Row[];
  xKey: string;
  series: Series[];
  height?: number;
  layout?: "horizontal" | "vertical";
  colors?: string[];
  emptyText?: string;
}) {
  if (!data.length) return <EmptyChart text={emptyText} height={height} />;
  const percent = series.every((item) => item.percent);
  const vertical = layout === "vertical";
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout={vertical ? "vertical" : "horizontal"} margin={{ top: 8, right: 12, left: vertical ? 8 : -12, bottom: 0 }}>
        <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={vertical} horizontal={!vertical} />
        {vertical ? (
          <>
            <XAxis type="number" {...axis} domain={percent ? [0, 1] : [0, "auto"]} tickFormatter={(value) => formatValue(value, percent)} />
            <YAxis type="category" dataKey={xKey} {...axis} width={150} />
          </>
        ) : (
          <>
            <XAxis dataKey={xKey} {...axis} interval={0} />
            <YAxis {...axis} domain={percent ? [0, 1] : [0, "auto"]} tickFormatter={(value) => formatValue(value, percent)} />
          </>
        )}
        <Tooltip {...tooltipStyle} cursor={{ fill: "rgba(255,255,255,0.04)" }} formatter={(value, name) => [formatValue(value, percent), name]} />
        {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12, color: "#a1a1aa" }} />}
        {series.map((item, index) => (
          <Bar key={item.key} dataKey={item.key} name={item.label} fill={item.color ?? SERIES_COLORS[index % SERIES_COLORS.length]} radius={4} maxBarSize={36}>
            {colors && series.length === 1 && data.map((_, cellIndex) => <Cell key={cellIndex} fill={colors[cellIndex % colors.length]} />)}
          </Bar>
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
