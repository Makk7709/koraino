import { CalendarDays, Download, ExternalLink, Unlink } from "lucide-react";
import { useEffect, useState } from "react";
import { BrandMark } from "@/components/kora/BrandMark";
import { formatDate, formatDateTime } from "@/components/kora/labels";
import { ConfidenceBadge, GhostButton, KoraCard, Pill } from "@/components/kora/primitives";
import type { SignalDetail } from "@/lib/api/types";
import { cn } from "@/lib/utils";
import { useSignalActions } from "./hooks";
import { KoraCheckbox } from "./KoraCheckbox";
import { VIA_LABEL } from "./signal-utils";
import { PerplexityPill } from "./SignalSources";

/** Observations rattachées au signal ; cocher puis « Détacher » = défusion. */
export function ObservationList({
  signal,
  onSplit,
  className,
}: {
  signal: SignalDetail;
  onSplit?: (createdId: string) => void;
  className?: string;
}) {
  const actions = useSignalActions();
  const [checked, setChecked] = useState<Set<string>>(new Set());
  useEffect(() => setChecked(new Set()), [signal.id]);

  const total = signal.observations.length;
  const canSplit = checked.size > 0 && checked.size < total;

  return (
    <KoraCard
      title="Observations"
      badge={
        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-kora-ink-soft tabular-nums">
          {total}
        </span>
      }
      action={
        checked.size > 0 ? (
          <GhostButton
            className="h-7 px-2.5 text-[11.5px]"
            disabled={!canSplit || actions.split.isPending}
            title={canSplit ? undefined : "Au moins une observation doit rester dans le signal"}
            onClick={() =>
              actions.split.mutate(
                { signalId: signal.id, observationIds: [...checked] },
                {
                  onSuccess: (r) => {
                    setChecked(new Set());
                    onSplit?.(r.created.id);
                  },
                },
              )
            }
          >
            <Unlink className="size-3.5" />
            Détacher ({checked.size})
          </GhostButton>
        ) : null
      }
      className={cn(className)}
    >
      {total === 0 ? (
        <p className="text-[12px] text-muted-foreground">Aucune observation rattachée.</p>
      ) : (
        <ul className="space-y-2">
          {signal.observations.map((o) => {
            const isChecked = checked.has(o.id);
            return (
              <li
                key={o.id}
                className="flex gap-2.5 rounded-xl border border-border bg-white px-2.5 py-2.5"
              >
                <KoraCheckbox
                  checked={isChecked}
                  label={`Sélectionner l'observation ${o.title}`}
                  className="mt-0.5"
                  onCheckedChange={(v) =>
                    setChecked((prev) => {
                      const next = new Set(prev);
                      if (v) next.add(o.id);
                      else next.delete(o.id);
                      return next;
                    })
                  }
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <BrandMark name={o.outlet.name} brand={o.outlet.brand} size="xs" />
                    <span className="text-[12px] font-semibold text-kora-ink">{o.outlet.name}</span>
                    <PerplexityPill via={o.via} />
                    {o.isSyndicated && (
                      <Pill tone="amber" size="sm" className="font-semibold">
                        Reprise
                      </Pill>
                    )}
                    {o.companyId === null ? (
                      <Pill tone="orange" size="sm" className="font-semibold">
                        À rattacher
                      </Pill>
                    ) : (
                      <ConfidenceBadge value={o.matchConfidence} />
                    )}
                  </div>
                  <p className="mt-1 text-[12.5px] leading-snug font-semibold text-kora-ink">
                    {o.title}
                  </p>
                  {o.excerpt && (
                    <p className="mt-0.5 line-clamp-3 text-[12px] leading-snug text-kora-ink-soft">
                      {o.excerpt}
                    </p>
                  )}
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <CalendarDays className="size-3" />
                      {formatDate(o.publishedAt)}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Download className="size-3" />
                      Collecté le {formatDateTime(o.collectedAt)}
                      {o.via && ` via ${VIA_LABEL[o.via]}`}
                    </span>
                    <a
                      href={o.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex items-center gap-1 font-medium text-kora-teal hover:underline"
                    >
                      <ExternalLink className="size-3" />
                      Ouvrir
                    </a>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {total > 1 && (
        <p className="mt-2.5 text-[11px] text-muted-foreground">
          Cochez des observations puis « Détacher » pour les isoler dans un nouveau signal
          (défusion).
        </p>
      )}
    </KoraCard>
  );
}
