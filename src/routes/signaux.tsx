import { createFileRoute } from "@tanstack/react-router";
import { Download, Merge, RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { GhostButton, PageTitle, UnderlineTabs } from "@/components/kora/primitives";
import { EvidencePanel } from "@/components/signals/EvidencePanel";
import { useSignalStatusCounts } from "@/components/signals/hooks";
import { MergeDialog } from "@/components/signals/MergeDialog";
import { ObservationList } from "@/components/signals/ObservationList";
import { ReviewPanel } from "@/components/signals/ReviewPanel";
import { ScoreBreakdown } from "@/components/signals/ScoreBreakdown";
import { SignalDetailCard } from "@/components/signals/SignalDetailCard";
import { SignalFiltersBar, type SignalFilters } from "@/components/signals/SignalFiltersBar";
import { SignalTable } from "@/components/signals/SignalTable";
import { StatusActions } from "@/components/signals/StatusActions";
import {
  byNewsDate,
  compact,
  isCategory,
  isSignalStatus,
  isTheme,
  plural,
  signalQuery,
} from "@/components/signals/signal-utils";
import { api, downloadUrl } from "@/lib/api/client";
import { useKoraMutation, useMe, useSignal, useSignals } from "@/lib/api/hooks";
import type { Category, Signal, SignalListQuery, SignalStatus, Theme } from "@/lib/api/types";

interface SignauxSearch {
  id?: string | undefined;
  status?: StatusTab | undefined;
  theme?: Theme | undefined;
  category?: Category | undefined;
  companyId?: string | undefined;
}

/** « prioritaires » : nouveaux ou à traiter avec un score ≥ 8/10, comme le dashboard. */
type StatusTab = SignalStatus | "tous" | "prioritaires";

/** Doit rester aligné sur le seuil serveur des « sujets prioritaires » du dashboard. */
const PRIORITY_MIN_SCORE = 80;
const PRIORITY_STATUSES = ["nouveau", "a_traiter"] as const satisfies SignalStatus[];
const LIST_LIMIT = 200;

const STATUS_TABS: { value: StatusTab; label: string }[] = [
  { value: "prioritaires", label: "Prioritaires" },
  { value: "nouveau", label: "Nouveautés" },
  { value: "a_traiter", label: "À traiter" },
  { value: "en_revue", label: "En revue" },
  { value: "surveille", label: "Surveillés" },
  { value: "traite", label: "Traités" },
  { value: "rejete", label: "Rejetés" },
  { value: "tous", label: "Tous" },
];

export const Route = createFileRoute("/signaux")({
  validateSearch: (s: Record<string, unknown>): SignauxSearch =>
    compact({
      id: typeof s["id"] === "string" ? s["id"] : undefined,
      status:
        s["status"] === "tous" || s["status"] === "prioritaires" || isSignalStatus(s["status"])
          ? s["status"]
          : undefined,
      theme: isTheme(s["theme"]) ? s["theme"] : undefined,
      category: isCategory(s["category"]) ? s["category"] : undefined,
      companyId: typeof s["companyId"] === "string" ? s["companyId"] : undefined,
    }),
  head: () => ({
    meta: [
      { title: "Signaux — Inovallée Newsroom IA" },
      { name: "description", content: "Sujets détectés, scorés et sourcés par le Signal Engine." },
    ],
  }),
  component: SignauxPage,
});

function SignauxPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const me = useMe();
  const status: StatusTab = search.status ?? (search.id ? "tous" : "nouveau");

  const [q, setQ] = useState<string | undefined>();
  const [outlet, setOutlet] = useState<string | undefined>();
  const [sort, setSort] = useState<"recent" | "score">("score");
  const [checked, setChecked] = useState<Map<string, Signal>>(new Map());
  const [mergeOpen, setMergeOpen] = useState(false);

  const base = {
    companyId: search.companyId,
    category: search.category,
    theme: search.theme,
    outlet,
    q,
  };
  const priorityTab = status === "prioritaires";
  const list = useSignals(
    signalQuery(
      priorityTab
        ? { ...base, status: PRIORITY_STATUSES[0], sort: "score", limit: LIST_LIMIT }
        : { ...base, status, sort, limit: LIST_LIMIT },
    ),
  );
  const priority = usePrioritySignals(signalQuery(base), sort);
  const statusCounts = useSignalStatusCounts(signalQuery(base));
  const counts: Partial<Record<StatusTab, number>> = {
    ...statusCounts,
    ...(priority.items ? { prioritaires: priority.items.length } : {}),
  };
  const items = priorityTab ? priority.items : list.data?.items;
  const total = priorityTab ? priority.items?.length : list.data?.total;
  const listPending = priorityTab ? priority.isPending : list.isPending;
  const listError = priorityTab ? priority.isError : list.isError;
  const detail = useSignal(search.id);

  const setSearch = useCallback(
    (patch: Partial<SignauxSearch>, replace = false) =>
      void navigate({ search: (prev) => compact({ ...prev, ...patch }), replace }),
    [navigate],
  );

  useEffect(() => {
    const first = items?.[0];
    if (!search.id && first) setSearch({ id: first.id }, true);
  }, [items, search.id, setSearch]);

  const filters: SignalFilters = {
    q,
    outlet,
    sort,
    companyId: search.companyId,
    category: search.category,
    theme: search.theme,
  };
  const onFilters = useCallback(
    (patch: Partial<SignalFilters>) => {
      if ("q" in patch) setQ(patch.q);
      if ("outlet" in patch) setOutlet(patch.outlet);
      if (patch.sort) setSort(patch.sort);
      const routePatch: Partial<SignauxSearch> = {};
      if ("companyId" in patch) routePatch.companyId = patch.companyId;
      if ("category" in patch) routePatch.category = patch.category;
      if ("theme" in patch) routePatch.theme = patch.theme;
      if (Object.keys(routePatch).length > 0) setSearch({ ...routePatch, id: undefined });
    },
    [setSearch],
  );

  const checkedIds = useMemo(() => new Set(checked.keys()), [checked]);
  const onCheck = useCallback(
    (id: string, v: boolean) => {
      setChecked((prev) => {
        const next = new Map(prev);
        const s = items?.find((x) => x.id === id);
        if (v && s) next.set(id, s);
        else next.delete(id);
        return next;
      });
    },
    [items],
  );

  const isAdmin = me.data?.roles.includes("admin") ?? false;
  const rescore = useKoraMutation(() => api.rescoreSignals(), {
    success: (r) =>
      `${plural(r.rescored, "signal recalculé", "signaux recalculés")} (grille active)`,
  });

  return (
    <div className="@container flex flex-col gap-4 pt-1">
      <PageTitle
        title="Signaux"
        subtitle="Sujets détectés, scorés et sourcés par le Signal Engine"
        actions={
          <>
            {isAdmin && (
              <GhostButton
                disabled={rescore.isPending}
                onClick={() => rescore.mutate(undefined)}
                className="h-8 text-[12px]"
              >
                <RefreshCw className={rescore.isPending ? "size-3.5 animate-spin" : "size-3.5"} />
                Recalculer les scores
              </GhostButton>
            )}
            <a
              href={downloadUrl.export("signals", "csv")}
              className="inline-flex h-8 items-center gap-2 rounded-lg border border-border bg-white px-3 text-[12px] font-medium text-kora-ink transition hover:border-kora-teal-light hover:bg-kora-teal-bg"
            >
              <Download className="size-3.5" />
              Exporter (CSV)
            </a>
          </>
        }
      />

      <UnderlineTabs
        tabs={STATUS_TABS.map((t) => {
          const count = counts[t.value];
          return count === undefined ? t : { ...t, count };
        })}
        value={status}
        onChange={(v) => {
          setChecked(new Map());
          setSearch({ status: v, id: undefined });
        }}
        className="gap-6 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&>button]:shrink-0"
      />

      <SignalFiltersBar value={filters} onChange={onFilters} />

      <div className="grid items-start gap-4 @min-[1040px]:grid-cols-[1.45fr_1fr]">
        <section className="kora-card min-w-0 px-4 pt-3.5 pb-3">
          <header className="flex flex-wrap items-center justify-between gap-2 pb-3">
            <h2 className="text-[15px] font-bold text-kora-ink">
              {total !== undefined ? plural(total, "signal", "signaux") : "Signaux"}
            </h2>
            {checked.size > 0 && (
              <div className="flex items-center gap-2 rounded-lg bg-kora-blue-bg px-2 py-1">
                <span className="text-[12px] font-semibold text-kora-blue">
                  {plural(checked.size, "sélectionné", "sélectionnés")}
                </span>
                <GhostButton
                  className="h-7 px-2.5 text-[11.5px]"
                  disabled={checked.size < 2}
                  title={checked.size < 2 ? "Cochez au moins deux signaux" : undefined}
                  onClick={() => setMergeOpen(true)}
                >
                  <Merge className="size-3.5" />
                  Fusionner
                </GhostButton>
                <button
                  type="button"
                  aria-label="Vider la sélection"
                  onClick={() => setChecked(new Map())}
                  className="rounded p-1 text-kora-blue hover:bg-white"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            )}
          </header>
          {listError ? (
            <div className="rounded-xl border border-dashed bg-white/60 px-6 py-8 text-center text-[13px] text-muted-foreground">
              Les signaux n&apos;ont pas pu être chargés.{" "}
              <button
                type="button"
                onClick={() => void (priorityTab ? priority.refetch() : list.refetch())}
                className="font-semibold text-kora-teal hover:underline"
              >
                Réessayer
              </button>
            </div>
          ) : (
            <SignalTable
              signals={items}
              loading={listPending}
              selectedId={search.id}
              onSelect={(id) => setSearch({ id })}
              checkedIds={checkedIds}
              onCheckedChange={onCheck}
              skeletonRows={7}
              emptyTitle="Aucun signal pour ces critères"
              emptyHint="Modifiez l'onglet de statut ou les filtres."
            />
          )}
          {items && total !== undefined && total > items.length && (
            <p className="pt-2.5 text-center text-[11.5px] text-muted-foreground">
              {items.length} premiers signaux affichés sur {total} — affinez les filtres pour voir
              les autres.
            </p>
          )}
        </section>

        <div className="flex min-w-0 flex-col gap-4">
          <SignalDetailCard signalId={search.id} />
          {detail.data && (
            <>
              <ReviewPanel
                signal={detail.data}
                onMerged={(id) => setSearch({ id, status: "tous" })}
              />
              <StatusActions signal={detail.data} />
              <ScoreBreakdown score={detail.data.score} />
              <EvidencePanel evidence={detail.data.evidence} />
              <ObservationList
                signal={detail.data}
                onSplit={(createdId) => setSearch({ id: createdId, status: "tous" })}
              />
            </>
          )}
        </div>
      </div>

      <MergeDialog
        open={mergeOpen}
        onOpenChange={setMergeOpen}
        signals={[...checked.values()]}
        onMerged={(targetId) => {
          setChecked(new Map());
          setSearch({ id: targetId });
        }}
      />
    </div>
  );
}

/** Sujets prioritaires : union des signaux nouveaux et à traiter au-dessus du seuil. */
function usePrioritySignals(
  base: Omit<SignalListQuery, "status" | "sort" | "limit">,
  sort: "recent" | "score",
) {
  const fresh = useSignals(
    signalQuery({ ...base, status: PRIORITY_STATUSES[0], sort: "score", limit: LIST_LIMIT }),
  );
  const todo = useSignals(
    signalQuery({ ...base, status: PRIORITY_STATUSES[1], sort: "score", limit: LIST_LIMIT }),
  );
  const items = useMemo(() => {
    if (!fresh.data || !todo.data) return undefined;
    return [...fresh.data.items, ...todo.data.items]
      .filter((s) => s.score.total >= PRIORITY_MIN_SCORE)
      .sort(
        sort === "score" ? (a, b) => b.score.total - a.score.total || byNewsDate(a, b) : byNewsDate,
      );
  }, [fresh.data, todo.data, sort]);
  return {
    items,
    isPending: fresh.isPending || todo.isPending,
    isError: fresh.isError || todo.isError,
    refetch: () => Promise.all([fresh.refetch(), todo.refetch()]),
  };
}
