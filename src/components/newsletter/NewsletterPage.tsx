import { useQueryClient } from "@tanstack/react-query";
import { Info, Plus } from "lucide-react";
import { useState } from "react";
import { EmptyState, PageTitle, Pill, PrimaryButton } from "@/components/kora/primitives";
import { NEWSLETTER_STATUS } from "@/components/kora/labels";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { qk, useNewsletters } from "@/lib/api/hooks";
import type { NewsletterEdition } from "@/lib/api/types";
import { useCompanyMap, usePermissions } from "@/components/articles/hooks";
import { Banner, DetailSkeleton, LoadError } from "@/components/articles/ui";
import { EditionWorkspace } from "./EditionWorkspace";
import { NewEditionDialog } from "./NewEditionDialog";
import { weekLabel } from "./format";
import type { NewsletterSearch } from "./search";

export function NewsletterPage({
  search,
  onSearch,
}: {
  search: NewsletterSearch;
  onSearch: (patch: NewsletterSearch) => void;
}) {
  const qc = useQueryClient();
  const editionsQuery = useNewsletters();
  const companies = useCompanyMap();
  const { canWrite } = usePermissions();
  const [newOpen, setNewOpen] = useState(false);

  const editions = [...(editionsQuery.data ?? [])].sort(
    (a, b) => b.weekOf.localeCompare(a.weekOf) || b.createdAt.localeCompare(a.createdAt),
  );
  const fallback = editions.find((e) => e.status === "composition") ?? editions[0];
  const selected = editions.find((e) => e.id === search.id) ?? (search.id ? undefined : fallback);

  return (
    <div>
      <PageTitle
        title="Newsletter"
        subtitle="Composition, approbation et export de l'édition hebdomadaire"
        actions={
          <PrimaryButton disabled={!canWrite} onClick={() => setNewOpen(true)}>
            <Plus className="size-4" /> Nouvelle édition
          </PrimaryButton>
        }
      />

      <Banner tone="info" icon={Info} className="mb-4">
        Export uniquement : l&apos;envoi de campagnes, les contacts et la délivrabilité sont hors
        périmètre.
      </Banner>

      <div className="kora-card mb-4 flex flex-wrap items-center gap-3 px-4 py-3">
        <p className="text-[13px] font-semibold text-kora-ink">Édition</p>
        <Select
          value={selected?.id ?? ""}
          onValueChange={(id) => onSearch({ id })}
          disabled={!editions.length}
        >
          <SelectTrigger className="h-9 w-full max-w-[520px] rounded-lg border-border bg-white text-[13px] text-kora-ink">
            <SelectValue placeholder={editionsQuery.isPending ? "Chargement…" : "Aucune édition"} />
          </SelectTrigger>
          <SelectContent>
            {editions.map((e) => (
              <SelectItem key={e.id} value={e.id} className="text-[13px]">
                {e.title} · {weekLabel(e.weekOf)} · {NEWSLETTER_STATUS[e.status].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {selected && (
          <Pill tone={NEWSLETTER_STATUS[selected.status].tone}>
            {NEWSLETTER_STATUS[selected.status].label}
          </Pill>
        )}
        <span className="ml-auto text-[12px] text-muted-foreground">
          {editions.length} édition{editions.length > 1 ? "s" : ""}
        </span>
      </div>

      {editionsQuery.isPending ? (
        <DetailSkeleton />
      ) : editionsQuery.isError ? (
        <LoadError error={editionsQuery.error} onRetry={() => void editionsQuery.refetch()} />
      ) : selected ? (
        <EditionWorkspace key={selected.id} edition={selected} companies={companies} />
      ) : search.id ? (
        <EmptyState title="Édition introuvable">
          Cette édition n&apos;existe plus. Choisissez-en une autre dans le sélecteur.
        </EmptyState>
      ) : (
        <EmptyState title="Aucune édition">
          Créez une première édition avec « Nouvelle édition ».
        </EmptyState>
      )}

      <NewEditionDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        onCreated={(e) => {
          qc.setQueryData<NewsletterEdition[]>(qk.newsletters, (old) => [
            e,
            ...(old ?? []).filter((x) => x.id !== e.id),
          ]);
          onSearch({ id: e.id });
        }}
      />
    </div>
  );
}
