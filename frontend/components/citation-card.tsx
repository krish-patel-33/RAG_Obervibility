"use client";

import type { Citation } from "@/lib/types";

export function CitationCard({ citation, onClick }: { citation: Citation; onClick?: () => void }) {
  const page = citation.page_start
    ? citation.page_end && citation.page_end !== citation.page_start
      ? `pp. ${citation.page_start}–${citation.page_end}`
      : `p. ${citation.page_start}`
    : null;
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-lg border border-white/[0.08] bg-white/[0.02] p-3 text-left transition-colors hover:border-white/15 hover:bg-white/[0.04]"
    >
      <div className="flex items-baseline gap-2 text-xs">
        <span className="font-medium text-zinc-400">{citation.label}</span>
        <span className="truncate font-medium text-zinc-200">{citation.filename}</span>
        {page && <span className="shrink-0 text-zinc-500">{page}</span>}
      </div>
      <p className="mt-1.5 line-clamp-2 text-xs leading-5 text-zinc-400">{citation.snippet}</p>
    </button>
  );
}
