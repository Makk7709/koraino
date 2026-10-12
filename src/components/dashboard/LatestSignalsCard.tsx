import { useEffect, useState } from "react";
import { SIGNAL_STATUS } from "@/components/kora/labels";
import { FilterSelect } from "@/components/signals/FilterSelect";
import { useCompanyOptions, useOutletOptions } from "@/components/signals/hooks";
import { SignalTable } from "@/components/signals/SignalTable";
import { SIGNAL_STATUSES, isSignalStatus, signalQuery } from "@/components/signals/signal-utils";
import { useSignals } from "@/lib/api/hooks";
import type { SignalStatus } from "@/lib/api/types";
import { cn } from "@/lib/utils";

const STATUS_OPTIONS = SIGNAL_STATUSES.map((s) => ({ value: s, label: SIGNAL_STATUS[s].label }));
const SORT_OPTIONS = [
  { value: "recent", label: "Plus récent" },
  { value: "score", label: "Meilleur score" },
];

/** Carte « Actualités détectées par l'IA » : filtres + table partagée. */
export function LatestSignalsCard({
  selectedId,
  onSelect,
  limit = 5,
  autoSelectFirst = true,
  className,
}: {
  selectedId: string | null;
  onSelect: (id: string) => void;
  limit?: number;
  /** Sélectionne la première ligne si la sélection courante n'est pas affichée. */
  autoSelectFirst?: boolean;
  className?: string;
}) {
  const [status, setStatus] = useState<SignalStatus | undefined>();
  const [companyId, setCompanyId] = useState<string | undefined>();
  const [outlet, setOutlet] = useState<string | undefined>();
  const [sort, setSort] = useState<"recent" | "score">("recent");
  const companyOptions = useCompanyOptions();
  const outletOptions = useOutletOptions();

  const q = useSignals(signalQuery({ status, companyId, outlet, sort, limit }));
  const items = q.data?.items;

  useEffect(() => {
    if (!autoSelectFirst) return;
    const first = items?.[0];
    if (first && (!selectedId || !items.some((s) => s.id === selectedId))) onSelect(first.id);
  }, [autoSelectFirst, items, selectedId, onSelect]);

  return (
    <section className={cn("kora-card flex min-w-0 flex-col px-4 pt-3.5 pb-3", className)}>
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 pb-3">
        <h2 className="text-[16px] font-bold tracking-tight text-kora-ink">
          Actualités détectées par l&apos;IA
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <FilterSelect
            label="Statut"
            allLabel="Tous les statuts"
            value={status}
            onValueChange={(v) => setStatus(isSignalStatus(v) ? v : undefined)}
            options={STATUS_OPTIONS}
          />
          <FilterSelect
            label="Entreprise"
            allLabel="Toutes les entreprises"
            value={companyId}
            onValueChange={setCompanyId}
            options={companyOptions}
            className="max-w-[11rem]"
          />
          <FilterSelect
            label="Source"
            allLabel="Toutes les sources"
            value={outlet}
            onValueChange={setOutlet}
            options={outletOptions}
            className="max-w-[11rem]"
          />
          <FilterSelect
            label="Tri"
            value={sort}
            onValueChange={(v) => setSort(v === "score" ? "score" : "recent")}
            options={SORT_OPTIONS}
            className="min-w-[7.5rem]"
          />
        </div>
      </header>
      {q.isError ? (
        <div className="rounded-xl border border-dashed bg-white/60 px-6 py-8 text-center text-[13px] text-muted-foreground">
          Les actualités n&apos;ont pas pu être chargées.{" "}
          <button
            type="button"
            onClick={() => void q.refetch()}
            className="font-semibold text-kora-teal hover:underline"
          >
            Réessayer
          </button>
        </div>
      ) : (
        <SignalTable
          signals={items}
          loading={q.isPending}
          selectedId={selectedId}
          onSelect={onSelect}
          skeletonRows={Math.min(limit, 6)}
        />
      )}
    </section>
  );
}
