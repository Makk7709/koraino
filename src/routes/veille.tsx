import { createFileRoute } from "@tanstack/react-router";
import { Crosshair, Plus, RefreshCw, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { GhostButton, PageTitle, PrimaryButton, UnderlineTabs } from "@/components/kora/primitives";
import { formatDateTime, formatRelative } from "@/components/kora/labels";
import { AddSourceDialog } from "@/components/veille/AddSourceDialog";
import { CollectionHistory } from "@/components/veille/CollectionHistory";
import { CoveragePanel } from "@/components/veille/CoveragePanel";
import { FailingSourcesAlert } from "@/components/veille/FailingSourcesAlert";
import { SourceRegistry } from "@/components/veille/SourceRegistry";
import { VeilleKpis } from "@/components/veille/VeilleKpis";
import {
  ALL,
  BlockSkeleton,
  useCompanyMap,
  usePermissions,
  type WithAll,
} from "@/components/veille/kit";
import { useCollectAll } from "@/components/veille/useCollect";
import { useCollectionRuns, useSources, useUsage } from "@/lib/api/hooks";
import type { Source, SourceAccess } from "@/lib/api/types";

const TABS = ["registre", "historique", "couverture"] as const;
type VeilleTab = (typeof TABS)[number];

interface VeilleSearch {
  /** Source à mettre en évidence (lien depuis la recherche globale ou une fiche). */
  source?: string | undefined;
  tab?: VeilleTab | undefined;
}

export const Route = createFileRoute("/veille")({
  validateSearch: (s: Record<string, unknown>): VeilleSearch => ({
    source: typeof s["source"] === "string" ? s["source"] : undefined,
    tab: TABS.includes(s["tab"] as VeilleTab) ? (s["tab"] as VeilleTab) : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Veille — Inovallée Newsroom IA" },
      {
        name: "description",
        content: "KORA Radar : registre des sources, collectes et erreurs d'accès.",
      },
    ],
  }),
  component: VeillePage,
});

const RUNS_QUERY = { limit: 500 };

function VeillePage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const tab: VeilleTab = search.source ? "registre" : (search.tab ?? "registre");
  const [access, setAccess] = useState<WithAll<SourceAccess>>(ALL);
  const [addOpen, setAddOpen] = useState(false);

  const { readOnly, readOnlyTitle } = usePermissions();
  const companies = useCompanyMap();
  const sources = useSources();
  const runs = useCollectionRuns(RUNS_QUERY);
  const usage = useUsage();
  const collectAll = useCollectAll();

  const sourceMap = useMemo(() => {
    const m = new Map<string, Source>();
    for (const s of sources.data ?? []) m.set(s.id, s);
    return m;
  }, [sources.data]);

  const lastRun = useMemo(
    () =>
      (runs.data ?? []).reduce<string | null>(
        (max, r) => (max === null || r.startedAt > max ? r.startedAt : max),
        null,
      ),
    [runs.data],
  );

  const highlighted = search.source ? sourceMap.get(search.source) : undefined;
  useEffect(() => {
    if (!highlighted) return;
    const t = window.setTimeout(() => {
      document
        .getElementById(`source-${highlighted.id}`)
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 120);
    return () => window.clearTimeout(t);
  }, [highlighted]);

  const setTab = (t: VeilleTab) =>
    void navigate({
      search: (prev) => ({
        ...prev,
        source: t === "registre" ? prev.source : undefined,
        tab: t === "registre" ? undefined : t,
      }),
      replace: true,
    });

  const focusSource = (id: string) =>
    void navigate({ search: (prev) => ({ ...prev, source: id, tab: undefined }) });

  return (
    <div className="space-y-4">
      <PageTitle
        title="Veille"
        subtitle="KORA Radar · registre des sources approuvées, collectes et erreurs d'accès"
        actions={
          <>
            <GhostButton onClick={() => setAddOpen(true)} disabled={readOnly} title={readOnlyTitle}>
              <Plus className="size-4" /> Ajouter une source
            </GhostButton>
            <PrimaryButton
              onClick={() => collectAll.mutate()}
              disabled={readOnly || collectAll.isPending}
              title={readOnlyTitle}
            >
              <RefreshCw className={collectAll.isPending ? "size-4 animate-spin" : "size-4"} />
              {collectAll.isPending ? "Collecte en cours…" : "Lancer la collecte"}
            </PrimaryButton>
          </>
        }
      />

      <VeilleKpis sources={sources.data} runs={runs.data} usage={usage.data} />

      {sources.data ? (
        <FailingSourcesAlert
          sources={sources.data}
          companies={companies.map}
          readOnly={readOnly}
          onShowAll={() => {
            setAccess("erreur");
            setTab("registre");
          }}
        />
      ) : (
        !sources.error && <BlockSkeleton className="h-12" />
      )}

      <section>
        <div className="mb-4 flex items-end justify-between gap-4 border-b border-border/80">
          <UnderlineTabs
            className="shadow-none"
            value={tab}
            onChange={setTab}
            tabs={[
              {
                value: "registre",
                label: "Registre des sources",
                ...(sources.data && { count: sources.data.length }),
              },
              { value: "historique", label: "Historique des collectes" },
              { value: "couverture", label: "Couverture" },
            ]}
          />
          <div className="flex items-center gap-3 pb-2 text-[12px] text-kora-ink-soft">
            {highlighted && (
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-kora-blue/25 bg-kora-blue-bg px-2 py-1 font-medium text-kora-blue">
                <Crosshair className="size-3.5" />
                Source ciblée : {highlighted.label}
                <button
                  type="button"
                  aria-label="Retirer la mise en évidence"
                  onClick={() =>
                    void navigate({
                      search: (prev) => ({ ...prev, source: undefined }),
                      replace: true,
                    })
                  }
                  className="rounded p-0.5 hover:bg-white"
                >
                  <X className="size-3" />
                </button>
              </span>
            )}
            {lastRun && (
              <span title={formatDateTime(lastRun)}>
                Dernière collecte{" "}
                <span className="font-semibold text-kora-ink">{formatRelative(lastRun)}</span>
              </span>
            )}
          </div>
        </div>

        {tab === "registre" && (
          <SourceRegistry
            sources={sources.data}
            companies={companies.map}
            isPending={sources.isPending}
            error={sources.error}
            onRetry={() => void sources.refetch()}
            access={access}
            onAccessChange={setAccess}
            highlightId={search.source}
            readOnly={readOnly}
          />
        )}
        {tab === "historique" && (
          <CollectionHistory
            runs={runs.data}
            sources={sourceMap}
            companies={companies.map}
            isPending={runs.isPending}
            error={runs.error}
            onRetry={() => void runs.refetch()}
            onSelectSource={focusSource}
          />
        )}
        {tab === "couverture" && (
          <CoveragePanel
            runs={runs.data}
            sources={sources.data}
            error={runs.error ?? sources.error}
            onRetry={() => {
              void runs.refetch();
              void sources.refetch();
            }}
          />
        )}
      </section>

      <AddSourceDialog open={addOpen} onOpenChange={setAddOpen} />
    </div>
  );
}
