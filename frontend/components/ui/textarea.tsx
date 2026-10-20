import * as React from "react";
import { cn } from "@/lib/utils";

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(({ className, ...props }, ref) => {
  return (
    <textarea
      ref={ref}
      className={cn(
        "flex min-h-24 w-full resize-none rounded-md border border-white/10 bg-zinc-950 px-3 py-3 text-sm text-zinc-100 outline-none transition-colors placeholder:text-zinc-600 focus:border-blue-400/50 focus:ring-2 focus:ring-blue-400/10 disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  );
});
Textarea.displayName = "Textarea";

export { Textarea };
