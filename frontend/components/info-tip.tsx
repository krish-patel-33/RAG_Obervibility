import { HelpCircle } from "lucide-react";
import { GLOSSARY } from "@/lib/glossary";

/** A "?" marker that explains a metric in plain language on hover or focus. */
export function InfoTip({ term }: { term: keyof typeof GLOSSARY | string }) {
  const entry = GLOSSARY[term];
  if (!entry) return null;
  return (
    <span className="group relative inline-flex align-middle">
      <button type="button" aria-label={`What is ${entry.title}?`} className="text-zinc-500 transition-colors hover:text-blue-300 focus:text-blue-300 focus:outline-none">
        <HelpCircle className="h-3.5 w-3.5" />
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute left-1/2 top-6 z-30 w-64 -translate-x-1/2 rounded-md border border-white/10 bg-zinc-900 p-3 text-left text-xs font-normal normal-case leading-5 tracking-normal text-zinc-300 opacity-0 shadow-xl transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
      >
        <span className="mb-1 block font-medium text-white">{entry.title}</span>
        {entry.text}
      </span>
    </span>
  );
}
