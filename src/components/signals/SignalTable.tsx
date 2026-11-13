import { ChevronRight } from "lucide-react";
import { Fragment, type ReactNode } from "react";
import { BrandMark } from "@/components/kora/BrandMark";
import { formatDate, formatDateShort } from "@/components/kora/labels";
import {
  ConfidenceBadge,
  EmptyState,
  Pill,
  ScorePill,
  StatusPill,
} from "@/components/kora/primitives";
import { Skeleton } from "@/components/ui/skeleton";
import type { Company, Signal } from "@/lib/api/types";
import { cn } from "@/lib/utils";
import { useCompanyIndex } from "./hooks";
import { KoraCheckbox } from "./KoraCheckbox";
import { ScoreInfoTooltip } from "./ScoreInfoTooltip";
import { signalDate } from "./signal-utils";

/** Colonnes : case · Entreprises · Date · Événement / Titre · Source · Score IA · Statut · chevron. */
const COLS =
  "grid-cols-[18px_minmax(108px,1.1fr)_minmax(74px,0.62fr)_minmax(150px,2.5fr)_minmax(106px,1.15fr)_66px_minmax(82px,0.8fr)_14px]";

const UNKNOWN_BRAND = { initials: "?", bg: "oklch(0.95 0.01 240)", fg: "oklch(0.55 0.04 257)" };

export interface SignalTableProps {
  signals: Signal[] | undefined;
  loading?: boolean;
  selectedId?: string | null | undefined;
  onSelect?: (id: string) => void;
  /** Sélection multiple (fusion). Sans elle, la case reflète la ligne sélectionnée. */
  checkedIds?: ReadonlySet<string>;
  onCheckedChange?: (id: string, checked: boolean) => void;
  skeletonRows?: number;
  emptyTitle?: string;
  emptyHint?: ReactNode;
  className?: string;
}

/** Table « Actualités détectées par l'IA » (dashboard et page Signaux). */
export function SignalTable({
  signals,
  loading,
  selectedId,
  onSelect,
  checkedIds,
  onCheckedChange,
  skeletonRows = 5,
  emptyTitle = "Aucune actualité pour ces filtres",
  emptyHint,
  className,
}: SignalTableProps) {
  const companies = useCompanyIndex();
  const rows = signals ?? [];
  const multi = checkedIds !== undefined;

  return (
    <div className={cn("kora-scrollbar overflow-x-auto", className)}>
      <div role="table" aria-label="Actualités détectées" className="min-w-[640px]">
        <div
          role="row"
          className={cn(
            "grid items-center gap-x-3 rounded-lg bg-muted px-2.5 py-2 text-[11px] font-medium text-muted-foreground",
            COLS,
          )}
        >
          <span role="columnheader" aria-label="Sélection" />
          <span role="columnheader">Entreprises</span>
          <span role="columnheader">Date</span>
          <span role="columnheader">Événement / Titre</span>
          <span role="columnheader">Source</span>
          <span role="columnheader" className="flex items-center gap-1.5 whitespace-nowrap">
            Score IA <ScoreInfoTooltip />
          </span>
          <span role="columnheader">Statut</span>
          <span role="columnheader" aria-hidden />
        </div>

        <div role="rowgroup" className="mt-1">
          {loading && Array.from({ length: skeletonRows }).map((_, i) => <SkeletonRow key={i} />)}

          {!loading && rows.length === 0 && (
            <div className="pt-3">
              <EmptyState title={emptyTitle}>{emptyHint}</EmptyState>
            </div>
          )}

          {!loading &&
            rows.map((s, i) => {
              const selected = s.id === selectedId;
              const nextSelected = rows[i + 1]?.id === selectedId;
              const checked = multi ? checkedIds.has(s.id) : selected;
              const company = s.companyId ? companies.get(s.companyId) : undefined;
              return (
                <Fragment key={s.id}>
                  <SignalRow
                    signal={s}
                    company={company}
                    selected={selected}
                    checked={checked}
                    onSelect={() => onSelect?.(s.id)}
                    onCheck={(v) => (multi ? onCheckedChange?.(s.id, v) : onSelect?.(s.id))}
                  />
                  {i < rows.length - 1 && !selected && !nextSelected && (
                    <div aria-hidden className="mx-2.5 h-px bg-border/70" />
                  )}
                  {i < rows.length - 1 && (selected || nextSelected) && (
                    <div aria-hidden className="h-px" />
                  )}
                </Fragment>
              );
            })}
        </div>
      </div>
    </div>
  );
}

function SignalRow({
  signal: s,
  company,
  selected,
  checked,
  onSelect,
  onCheck,
}: {
  signal: Signal;
  company: Company | undefined;
  selected: boolean;
  checked: boolean;
  onSelect: () => void;
  onCheck: (checked: boolean) => void;
}) {
  const name = company?.name ?? (s.companyId ? "Entreprise" : "À rattacher");
  return (
    <div
      role="row"
      aria-selected={selected}
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        "group grid cursor-pointer items-center gap-x-3 rounded-xl border px-2.5 py-1.5 transition-colors focus-visible:ring-2 focus-visible:ring-kora-blue/30 focus-visible:outline-none",
        COLS,
        selected
          ? "border-kora-blue/35 bg-kora-blue-bg/75 shadow-[0_2px_10px_-4px_oklch(0.592_0.157_253.3/30%)]"
          : "border-transparent hover:bg-muted/70",
      )}
    >
      <span role="cell" className="flex items-center">
        <KoraCheckbox
          checked={checked}
          onCheckedChange={onCheck}
          label={`Sélectionner : ${s.title}`}
        />
      </span>

      <span role="cell" className="flex min-w-0 items-center gap-2">
        <BrandMark
          name={company?.name ?? name}
          brand={company?.brand ?? UNKNOWN_BRAND}
          domain={company?.domain}
          size="sm"
        />
        <span className="min-w-0">
          <span
            className={cn(
              "line-clamp-2 text-[12.5px] leading-tight font-bold",
              company ? "text-kora-ink" : "text-kora-amber",
            )}
          >
            {name}
          </span>
          {s.companyId ? (
            <ConfidenceBadge value={s.matchConfidence} className="mt-1 px-1.5 py-px text-[9.5px]" />
          ) : (
            <Pill tone="amber" size="sm" className="mt-1">
              Rattachement à revoir
            </Pill>
          )}
        </span>
      </span>

      <span
        role="cell"
        title={formatDate(signalDate(s))}
        className="text-[11.5px] leading-tight whitespace-nowrap text-kora-ink-soft"
      >
        {formatDateShort(signalDate(s))}
      </span>

      <span role="cell" className="min-w-0">
        <span className="line-clamp-2 text-[12.5px] leading-[1.3] font-bold text-kora-ink">
          {s.title}
        </span>
        <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{s.summary}</span>
      </span>

      <span role="cell" className="flex min-w-0 items-center gap-1.5">
        <BrandMark name={s.primaryOutlet.name} brand={s.primaryOutlet.brand} size="sm" />
        <span
          className="line-clamp-2 text-[11.5px] leading-tight text-kora-ink-soft"
          title={s.primaryOutlet.name}
        >
          {s.primaryOutlet.name}
        </span>
      </span>

      <span role="cell">
        <ScorePill total={s.score.total} className="min-w-[3.1rem] px-2 py-1.5" />
      </span>

      <span role="cell">
        <StatusPill status={s.status} className="min-w-[5.25rem] py-1.5 text-[12px]" />
      </span>

      <span role="cell" className="flex justify-end">
        <ChevronRight
          className={cn(
            "size-4 transition-colors",
            selected ? "text-kora-ink" : "text-muted-foreground group-hover:text-kora-ink",
          )}
        />
      </span>
    </div>
  );
}

function SkeletonRow() {
  return (
    <div className={cn("grid items-center gap-x-3 border-b border-border/60 px-2.5 py-3", COLS)}>
      <Skeleton className="size-4 rounded-[5px]" />
      <span className="flex items-center gap-2.5">
        <Skeleton className="size-10 rounded-lg" />
        <span className="flex-1 space-y-1.5">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-3 w-12" />
        </span>
      </span>
      <Skeleton className="h-3 w-14" />
      <span className="space-y-1.5">
        <Skeleton className="h-3 w-[90%]" />
        <Skeleton className="h-3 w-[60%]" />
      </span>
      <span className="flex items-center gap-2">
        <Skeleton className="size-8 rounded-lg" />
        <Skeleton className="h-3 w-12" />
      </span>
      <Skeleton className="h-8 w-12 rounded-lg" />
      <Skeleton className="h-7 w-20 rounded-md" />
      <span />
    </div>
  );
}
