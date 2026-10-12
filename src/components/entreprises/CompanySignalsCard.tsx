import { ChevronRight } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CountBadge,
  EmptyState,
  KoraCard,
  ScorePill,
  StatusPill,
} from "@/components/kora/primitives";
import { CATEGORY, formatDate, formatRelative } from "@/components/kora/labels";
import { ErrorPanel, HrefLink } from "@/components/veille/kit";
import { useSignals } from "@/lib/api/hooks";

export function CompanySignalsCard({ companyId }: { companyId: string }) {
  const signals = useSignals({ companyId, limit: 6, sort: "recent" });

  return (
    <KoraCard
      title="Derniers signaux"
      badge={signals.data && <CountBadge value={signals.data.total} tone="blue" />}
    >
      {signals.error ? (
        <ErrorPanel
          title="Les signaux de l'entreprise n'ont pas pu être chargés"
          error={signals.error}
          onRetry={() => void signals.refetch()}
        />
      ) : signals.isPending ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-lg" />
          ))}
        </div>
      ) : signals.data.items.length === 0 ? (
        <EmptyState title="Aucun signal détecté pour cette entreprise" />
      ) : (
        <ul className="-mx-2 space-y-0.5">
          {signals.data.items.map((s) => (
            <li key={s.id}>
              <HrefLink
                href={`/signaux?id=${encodeURIComponent(s.id)}`}
                className="group flex items-center gap-3 rounded-lg px-2 py-2 transition hover:bg-kora-teal-bg/60"
              >
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-[13px] leading-snug font-bold text-kora-ink group-hover:text-kora-teal-dark">
                    {s.title}
                  </p>
                  <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                    {formatDate(s.publishedAt)} · {CATEGORY[s.category].label} ·{" "}
                    {s.primaryOutlet.name} · collecté {formatRelative(s.collectedAt)}
                  </p>
                </div>
                <ScorePill total={s.score.total} className="text-[14px]" />
                <StatusPill status={s.status} />
                <ChevronRight className="size-4 shrink-0 text-kora-ink-soft" />
              </HrefLink>
            </li>
          ))}
        </ul>
      )}
    </KoraCard>
  );
}
