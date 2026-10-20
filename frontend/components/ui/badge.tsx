import * as React from "react";
import { cn } from "@/lib/utils";

export function Badge({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("inline-flex items-center rounded border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-xs font-medium text-zinc-300", className)}
      {...props}
    />
  );
}
