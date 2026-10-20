"use client";

import { cn } from "@/lib/utils";

export function Segmented<T extends string | number>({ value, onChange, options }: { value: T; onChange: (value: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div className="inline-flex rounded-md border border-white/10 bg-white/[0.03] p-0.5">
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          onClick={() => onChange(option.value)}
          className={cn("rounded px-3 py-1.5 text-xs font-medium transition-colors", option.value === value ? "bg-white/10 text-white" : "text-zinc-400 hover:text-white")}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
