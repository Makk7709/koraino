import { Flag } from "lucide-react";
import { Pill } from "@/components/kora/primitives";
import { THEME } from "@/components/kora/labels";
import type { CompanyPriority, Theme } from "@/lib/api/types";
import { cn } from "@/lib/utils";
import { PRIORITY } from "./labels";

export function PriorityPill({
  priority,
  size = "md",
}: {
  priority: CompanyPriority;
  size?: "sm" | "md";
}) {
  const p = PRIORITY[priority];
  return (
    <Pill tone={p.tone} size={size} className="gap-1">
      <Flag className={size === "sm" ? "size-2.5" : "size-3"} />
      {p.label}
    </Pill>
  );
}

export function ThemePills({
  themes,
  max,
  className,
}: {
  themes: Theme[];
  max?: number;
  className?: string;
}) {
  const shown = max === undefined ? themes : themes.slice(0, max);
  const rest = themes.length - shown.length;
  return (
    <div className={cn("flex flex-wrap gap-1", className)}>
      {shown.map((t) => (
        <Pill key={t} tone={THEME[t].tone} size="sm">
          {THEME[t].label}
        </Pill>
      ))}
      {rest > 0 && (
        <Pill tone="gray" size="sm" className="tabular-nums">
          +{rest}
        </Pill>
      )}
      {themes.length === 0 && (
        <span className="text-[11px] text-muted-foreground">Aucune thématique</span>
      )}
    </div>
  );
}
