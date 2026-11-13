import { useMemo, useState } from "react";
import { BrandMark } from "@/components/kora/BrandMark";
import { CountBadge, KoraCard, Pill } from "@/components/kora/primitives";
import { RUN_STATUS, formatDateTime } from "@/components/kora/labels";
import type { CollectionRun, CollectionRunStatus, Company, Source } from "@/lib/api/types";
import { cn } from "@/lib/utils";
import {
  ALL,
  DataTable,
  EmptyRow,
  ErrorPanel,
  FilterBar,
  FilterSelect,
  Pager,
  SearchField,
  TableSkeleton,
  Td,
  Th,
  Tr,
  usePaged,
  type WithAll,
} from "./kit";
import { RUN_STATUS_OPTIONS } from "./labels";
import { runDuration } from "./runs";

const PAGE_SIZE = 20;

export function CollectionHistory({
  runs,
  sources,
  companies,
  isPending,
  error,
  onRetry,
  onSelectSource,
}: {
  runs: CollectionRun[] | undefined;
  sources: Map<string, Source>;
  companies: Map<string, Company>;
  isPending: boolean;
  error: unknown;
  onRetry: () => void;
  onSelectSource: (sourceId: string) => void;
}) {
  const [status, setStatus] = useState<WithAll<CollectionRunStatus>>(ALL);
  const [q, setQ] = useState("");

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (runs ?? [])
      .filter((r) => status === ALL || r.status === status)
      .filter((r) => {
        if (!needle) return true;
        const label = sources.get(r.sourceId)?.label ?? "";
        const name = companies.get(r.companyId)?.name ?? "";
        return [label, name, r.errorCode ?? ""].some((v) => v.toLowerCase().includes(needle));
      })
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }, [runs, sources, companies, status, q]);

  const paged = usePaged(rows, PAGE_SIZE, { resetKey: `${status}|${q}` });

  return (
    <KoraCard
      title="Historique des collectes"
      badge={runs && <CountBadge value={runs.length} tone="blue" />}
      action={
        <FilterBar>
          <SearchField value={q} onChange={setQ} placeholder="Source, entreprise, code…" />
          <FilterSelect
            value={status}
            onChange={setStatus}
            options={RUN_STATUS_OPTIONS}
            allLabel="Tous les statuts"
          />
        </FilterBar>
      }
    >
      {error ? (
        <ErrorPanel
          title="L'historique des collectes n'a pas pu être chargé"
          error={error}
          onRetry={onRetry}
        />
      ) : isPending ? (
        <TableSkeleton rows={8} cols={6} />
      ) : (
        <>
          <DataTable>
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Source</Th>
                <Th>Statut</Th>
                <Th className="text-right">Nouvelles observations</Th>
                <Th>Perplexity</Th>
                <Th>Code d&apos;erreur</Th>
              </tr>
            </thead>
            <tbody>
              {paged.slice.length === 0 && (
                <EmptyRow colSpan={6}>Aucune collecte ne correspond à ces filtres.</EmptyRow>
              )}
              {paged.slice.map((r) => {
                const source = sources.get(r.sourceId);
                const company = companies.get(r.companyId);
                const st = RUN_STATUS[r.status];
                return (
                  <Tr key={r.id} interactive onClick={() => onSelectSource(r.sourceId)}>
                    <Td className="whitespace-nowrap">
                      <p className="text-[12.5px] font-medium tabular-nums">
                        {formatDateTime(r.startedAt)}
                      </p>
                      <p className="text-[11px] text-muted-foreground">{runDuration(r)}</p>
                    </Td>
                    <Td className="max-w-[320px]">
                      <div className="flex items-center gap-2.5">
                        {company ? (
                          <BrandMark
                            name={company.name}
                            brand={company.brand}
                            domain={company.domain}
                            size="sm"
                          />
                        ) : (
                          <span className="size-8 shrink-0 rounded-lg bg-muted" />
                        )}
                        <div className="min-w-0">
                          <p className="truncate font-bold">
                            {company?.name ?? "Entreprise inconnue"}
                          </p>
                          <p className="truncate text-[11px] text-muted-foreground">
                            {source?.label ?? "Source supprimée"}
                          </p>
                        </div>
                      </div>
                    </Td>
                    <Td>
                      <Pill tone={st.tone} className="min-w-[7rem]">
                        {st.label}
                      </Pill>
                    </Td>
                    <Td className="text-right">
                      <span
                        className={cn(
                          "text-[14px] font-bold tabular-nums",
                          r.newObservations > 0 ? "text-kora-green" : "text-muted-foreground",
                        )}
                      >
                        {r.newObservations > 0 ? `+${r.newObservations}` : "0"}
                      </span>
                    </Td>
                    <Td className="max-w-[220px]">
                      <EnrichmentCell enrichment={r.enrichment} />
                    </Td>
                    <Td className="max-w-[300px]">
                      {r.errorCode ? (
                        <div className="flex min-w-0 items-center gap-2">
                          <Pill tone="rose" size="sm" className="font-mono">
                            {r.errorCode}
                          </Pill>
                          <span
                            className="truncate text-[12px] text-kora-ink-soft"
                            title={r.errorMessage ?? ""}
                          >
                            {r.errorMessage}
                          </span>
                        </div>
                      ) : (
                        <span className="text-[12px] text-muted-foreground">—</span>
                      )}
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </DataTable>
          <Pager {...paged} unit="collectes" />
        </>
      )}
    </KoraCard>
  );
}

/** Bilan de la recherche Perplexity d'une exécution ; « — » si elle n'a pas eu lieu. */
function EnrichmentCell({ enrichment }: { enrichment: CollectionRun["enrichment"] }) {
  if (!enrichment) return <span className="text-[12px] text-muted-foreground">—</span>;
  if (enrichment.status !== "ok") {
    const failed = enrichment.status === "erreur";
    return (
      <div className="flex min-w-0 items-center gap-2" title={enrichment.message ?? ""}>
        <Pill tone={failed ? "rose" : "gray"} size="sm" className="font-semibold">
          {failed ? "Erreur" : "Non configuré"}
        </Pill>
        <span className="truncate text-[12px] text-kora-ink-soft">{enrichment.message}</span>
      </div>
    );
  }
  return (
    <p className="text-[12px] text-kora-ink-soft tabular-nums">
      {enrichment.received} résultat{enrichment.received > 1 ? "s" : ""} · {enrichment.matched}{" "}
      pertinent{enrichment.matched > 1 ? "s" : ""}
      {enrichment.added > 0 && (
        <span className="font-semibold text-kora-green"> · +{enrichment.added}</span>
      )}
    </p>
  );
}
