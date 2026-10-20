import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatMs(value?: number | null) {
  if (value === null || value === undefined) return "n/a";
  if (value < 1000) return `${Math.round(value)} ms`;
  return `${(value / 1000).toFixed(2)} s`;
}

export function formatCost(value?: number | null) {
  if (value === null || value === undefined) return "$0.0000";
  return `$${value.toFixed(4)}`;
}

export function shortId(value?: string | number | null, length = 8) {
  if (value === null || value === undefined) return "n/a";
  const text = String(value);
  return text.length <= length ? text : text.slice(0, length);
}

export function classForStatus(status?: string) {
  switch (status) {
    case "ready":
    case "completed":
    case "answered":
    case "ok":
      return "border-emerald-400/30 bg-emerald-400/10 text-emerald-200";
    case "processing":
    case "queued":
    case "running":
    case "pending":
    case "no_answer":
    case "not_ready":
      return "border-amber-400/30 bg-amber-400/10 text-amber-200";
    case "failed":
    case "llm_failed":
    case "error":
      return "border-red-400/30 bg-red-400/10 text-red-200";
    default:
      return "border-white/10 bg-white/5 text-zinc-300";
  }
}

export function formatPercent(value?: number | null, digits = 0) {
  if (value === null || value === undefined) return "n/a";
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatNumber(value?: number | null) {
  if (value === null || value === undefined) return "n/a";
  return new Intl.NumberFormat("en", { notation: value >= 100000 ? "compact" : "standard" }).format(value);
}

export function formatDate(value?: string | null) {
  if (!value) return "n/a";
  const date = new Date(value.endsWith("Z") || value.includes("+") ? value : `${value}Z`);
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export const CATEGORY_COLORS: Record<string, string> = {
  retrieval_failure: "#fbbf24",
  context_construction_failure: "#c4b5fd",
  generation_failure: "#fca5a5",
  system_error: "#f87171",
  none: "#6ee7b7"
};

export const CATEGORY_LABELS: Record<string, string> = {
  retrieval_failure: "Retrieval failure",
  context_construction_failure: "Context problem",
  generation_failure: "Generation failure",
  system_error: "System error",
  none: "No failure"
};

export function classForCategory(category?: string | null) {
  switch (category) {
    case "none":
      return "border-emerald-400/30 bg-emerald-400/10 text-emerald-200";
    case "retrieval_failure":
      return "border-amber-400/30 bg-amber-400/10 text-amber-200";
    case "context_construction_failure":
      return "border-violet-400/30 bg-violet-400/10 text-violet-200";
    case "generation_failure":
    case "system_error":
      return "border-red-400/30 bg-red-400/10 text-red-200";
    default:
      return "border-white/10 bg-white/5 text-zinc-400";
  }
}
