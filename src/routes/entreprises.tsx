import { createFileRoute } from "@tanstack/react-router";
import { LayoutGrid, List, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { EmptyState, KoraCard, PageTitle, PrimaryButton } from "@/components/kora/primitives";
import { CompanyDetailSheet } from "@/components/entreprises/CompanyDetailSheet";
import { CompanyGrid } from "@/components/entreprises/CompanyGrid";
import { CompanyTable } from "@/components/entreprises/CompanyTable";
import { CreateCompanyDialog } from "@/components/entreprises/CreateCompanyDialog";
import { QuotaChip } from "@/components/entreprises/QuotaChip";
import { PRIORITY_OPTIONS, THEME_OPTIONS } from "@/components/entreprises/labels";
import {
  ALL,
  CardGridSkeleton,
  ErrorPanel,
  FilterBar,
  FilterSelect,
  Pager,
  SearchField,
  SegmentedToggle,
  TableSkeleton,
  usePaged,
  usePermissions,
  type WithAll,
} from "@/components/veille/kit";
import { useCompanies, useUsage } from "@/lib/api/hooks";
import type { Company, CompanyPriority, Theme } from "@/lib/api/types";

export const Route = createFileRoute("/entreprises")({
  validateSearch: (s: Record<string, unknown>): { id?: string | undefined } => ({
    id: typeof s["id"] === "string" ? s["id"] : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Entreprises — Inovallée Newsroom IA" },
      {
        name: "description",
        content: "Registre des entreprises suivies, alias et sources rattachées.",
      },
    ],
  }),
  component: EntreprisesPage,
});

type View = "grille" | "table";
type Health = "echec" | "sans_source";
type Sort = "nom" | "signaux" | "echecs" | "priorite";

const PAGE_SIZE = 24;
const PRIORITY_RANK: Record<CompanyPriority, number> = { haute: 0, normale: 1, basse: 2 };
const SORTERS: Record<Sort, (a: Company, b: Company) => number> = {
  nom: (a, b) => a.name.localeCompare(b.name, "fr"),
  signaux: (a, b) => b.signalCount - a.signalCount,
  echecs: (a, b) => b.failingSourceCount - a.failingSourceCount,
  priorite: (a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority],
};

function matches(c: Company, needle: string): boolean {
  if (!needle) return true;
  return [c.name, c.domain, c.sector, c.territory, ...c.aliases].some((v) =>
    v.toLowerCase().includes(needle),
  );
}

function EntreprisesPage() {
  const { id } = Route.useSearch();
  const navigate = Route.useNavigate();
  const { readOnly, readOnlyTitle } = usePermissions();
  const companies = useCompanies();
  const usage = useUsage();

  const [q, setQ] = useState("");
  const [theme, setTheme] = useState<WithAll<Theme>>(ALL);
  const [priority, setPriority] = useState<WithAll<CompanyPriority>>(ALL);
  const [health, setHealth] = useState<WithAll<Health>>(ALL);
  const [sort, setSort] = useState<Sort>("nom");
  const [view, setView] = useState<View>("grille");
  const [createOpen, setCreateOpen] = useState(false);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (companies.data ?? [])
      .filter((c) => matches(c, needle))
      .filter((c) => theme === ALL || c.themes.includes(theme))
      .filter((c) => priority === ALL || c.priority === priority)
      .filter((c) =>
        health === ALL ? true : health === "echec" ? c.failingSourceCount > 0 : c.sourceCount === 0,
      )
      .sort((a, b) => SORTERS[sort](a, b) || SORTERS.nom(a, b));
  }, [companies.data, q, theme, priority, health, sort]);

  const paged = usePaged(rows, PAGE_SIZE, {
    resetKey: `${q}|${theme}|${priority}|${health}|${sort}`,
  });

  const meter = usage.data?.meters.find((m) => m.key === "companies");
  const quota = meter
    ? { used: meter.used, limit: meter.limit }
    : companies.data
      ? { used: companies.data.length, limit: 150 }
      : null;

  const open = (companyId: string) =>
    void navigate({ search: (prev) => ({ ...prev, id: companyId }) });
  const close = () => void navigate({ search: (prev) => ({ ...prev, id: undefined }) });

  return (
    <div className="space-y-4">
      <PageTitle
        title="Entreprises"
        subtitle="Registre KORA Radar · raison sociale, alias, domaine officiel, priorités et sources rattachées"
        actions={
          <>
            <QuotaChip quota={quota} />
            <PrimaryButton
              onClick={() => setCreateOpen(true)}
              disabled={readOnly}
              title={readOnlyTitle}
            >
              <Plus className="size-4" /> Ajouter une entreprise
            </PrimaryButton>
          </>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <FilterBar>
          <SearchField
            value={q}
            onChange={setQ}
            placeholder="Nom, alias, domaine, secteur…"
            className="w-72"
          />
          <FilterSelect
            value={theme}
            onChange={setTheme}
            options={THEME_OPTIONS}
            allLabel="Toutes les thématiques"
          />
          <FilterSelect
            value={priority}
            onChange={setPriority}
            options={PRIORITY_OPTIONS}
            allLabel="Toutes les priorités"
          />
          <FilterSelect
            value={health}
            onChange={setHealth}
            options={[
              { value: "echec", label: "Avec source en échec" },
              { value: "sans_source", label: "Sans source" },
            ]}
            allLabel="Toutes les sources"
          />
          <FilterSelect<Sort>
            value={sort}
            onChange={(v) => setSort(v === ALL ? "nom" : v)}
            options={[
              { value: "nom", label: "Nom (A → Z)" },
              { value: "priorite", label: "Priorité" },
              { value: "signaux", label: "Plus de signaux" },
              { value: "echecs", label: "Sources en échec" },
            ]}
            ariaLabel="Trier"
          />
        </FilterBar>
        <div className="flex items-center gap-3">
          {companies.data && (
            <span className="text-[12px] text-kora-ink-soft tabular-nums">
              {rows.length} entreprise{rows.length > 1 ? "s" : ""} affichée
              {rows.length > 1 ? "s" : ""}
            </span>
          )}
          <SegmentedToggle
            value={view}
            onChange={setView}
            options={[
              { value: "grille", label: "Grille", icon: LayoutGrid },
              { value: "table", label: "Table", icon: List },
            ]}
          />
        </div>
      </div>

      {companies.error ? (
        <ErrorPanel
          title="Le registre des entreprises n'a pas pu être chargé"
          error={companies.error}
          onRetry={() => void companies.refetch()}
        />
      ) : view === "grille" ? (
        companies.isPending ? (
          <CardGridSkeleton count={9} className="grid-cols-3 2xl:grid-cols-4" />
        ) : rows.length === 0 ? (
          <EmptyState title="Aucune entreprise ne correspond à ces filtres">
            Modifiez la recherche ou les filtres pour élargir la sélection.
          </EmptyState>
        ) : (
          <div>
            <CompanyGrid companies={paged.slice} selectedId={id} onOpen={open} />
            <Pager {...paged} unit="entreprises" />
          </div>
        )
      ) : (
        <KoraCard title="Registre des entreprises" bodyClassName="pt-1">
          {companies.isPending ? (
            <TableSkeleton rows={8} cols={8} />
          ) : (
            <>
              <CompanyTable companies={paged.slice} selectedId={id} onOpen={open} />
              <Pager {...paged} unit="entreprises" />
            </>
          )}
        </KoraCard>
      )}

      <CreateCompanyDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        quota={quota}
        onCreated={(c) => open(c.id)}
      />
      <CompanyDetailSheet id={id} onClose={close} readOnly={readOnly} />
    </div>
  );
}
