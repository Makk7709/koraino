import { Building2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { TONE_CLASSES } from "@/components/kora/labels";
import { formatNumber, ratioTone } from "@/components/veille/kit";
import { cn } from "@/lib/utils";

/** Compteur « 150 / 150 entreprises (quota) » de l'en-tête de page. */
export function QuotaChip({ quota }: { quota: { used: number; limit: number } | null }) {
  if (!quota) return <Skeleton className="h-9 w-56 rounded-lg" />;
  const ratio = quota.limit ? quota.used / quota.limit : 0;
  const tone = TONE_CLASSES[ratioTone(ratio)];
  return (
    <span
      className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-white px-3 text-[12px] text-kora-ink-soft shadow-[0_1px_2px_oklch(0.289_0.062_263.9/5%)]"
      title="Quota mensuel d'entreprises suivies (§12)"
    >
      <Building2 className="size-4 text-kora-teal" />
      <span className="text-[14px] font-bold text-kora-ink tabular-nums">
        {formatNumber(quota.used)} / {formatNumber(quota.limit)}
      </span>
      entreprises
      <span className={cn("rounded-md px-1.5 py-0.5 text-[10px] font-semibold", tone.bg, tone.fg)}>
        {ratio >= 1 ? "quota atteint" : "quota"}
      </span>
    </span>
  );
}
