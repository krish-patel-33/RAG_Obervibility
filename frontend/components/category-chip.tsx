import { Badge } from "@/components/ui/badge";
import { CATEGORY_LABELS, classForCategory, cn } from "@/lib/utils";

export function CategoryChip({ category, confidence }: { category?: string | null; confidence?: string | null }) {
  if (!category) return <Badge className="text-zinc-500">not diagnosed</Badge>;
  return (
    <Badge className={cn(classForCategory(category))}>
      {CATEGORY_LABELS[category] ?? category}
      {confidence === "suspected" && category !== "none" && <span className="ml-1 opacity-70">(suspected)</span>}
    </Badge>
  );
}
