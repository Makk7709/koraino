import { Factory, Globe, Lightbulb, MapPin, Radio, Trash2, TriangleAlert } from "lucide-react";
import { useEffect, useState, type ComponentType } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { BrandMark } from "@/components/kora/BrandMark";
import { IconTile } from "@/components/kora/primitives";
import type { Tone } from "@/components/kora/labels";
import { ConfirmDialog, ErrorPanel, ExternalAnchor, KoraSheet } from "@/components/veille/kit";
import { api } from "@/lib/api/client";
import { useKoraMutation } from "@/lib/api/hooks";
import type { Company } from "@/lib/api/types";
import { cn } from "@/lib/utils";
import { PriorityPill, ThemePills } from "./CompanyBits";
import { CompanyEditCard } from "./CompanyEditCard";
import { CompanySignalsCard } from "./CompanySignalsCard";
import { CompanySourcesCard } from "./CompanySourcesCard";
import { useCompanyDetail } from "./useCompanyDetail";

function MiniStat({
  icon,
  tone,
  value,
  label,
  alert = false,
}: {
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  tone: Tone;
  value: number;
  label: string;
  alert?: boolean;
}) {
  return (
    <div className="kora-card flex items-center gap-2.5 px-3 py-2.5">
      <IconTile icon={icon} tone={tone} size="md" />
      <div className="min-w-0">
        <p
          className={cn(
            "text-[18px] leading-none font-bold tabular-nums",
            alert ? "text-kora-rose" : "text-kora-ink",
          )}
        >
          {value}
        </p>
        <p className="mt-1 truncate text-[11px] text-kora-ink-soft">{label}</p>
      </div>
    </div>
  );
}

function SheetHeader({ company: c }: { company: Company }) {
  return (
    <header className="border-b border-border/80 bg-white/90 px-6 pt-5 pb-4">
      <div className="flex items-start gap-4 pr-8">
        <BrandMark name={c.name} brand={c.brand} domain={c.domain} size="lg" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[20px] leading-tight font-bold text-kora-ink">{c.name}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
            <ExternalAnchor href={`https://${c.domain}`} className="inline-flex items-center gap-1">
              <Globe className="size-3" /> {c.domain}
            </ExternalAnchor>
            <span className="inline-flex items-center gap-1 text-kora-ink-soft">
              <Factory className="size-3" /> {c.sector}
            </span>
            <span className="inline-flex items-center gap-1 text-kora-ink-soft">
              <MapPin className="size-3" /> {c.territory || "Territoire non renseigné"}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <PriorityPill priority={c.priority} size="sm" />
            <ThemePills themes={c.themes} />
          </div>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-3">
        <MiniStat icon={Radio} tone="teal" value={c.sourceCount} label="sources rattachées" />
        <MiniStat
          icon={TriangleAlert}
          tone="rose"
          value={c.failingSourceCount}
          label="sources en échec"
          alert={c.failingSourceCount > 0}
        />
        <MiniStat icon={Lightbulb} tone="amber" value={c.signalCount} label="signaux détectés" />
      </div>
    </header>
  );
}

function SheetSkeleton() {
  return (
    <div className="space-y-4 p-6" aria-busy="true" aria-label="Chargement de la fiche">
      <div className="flex items-center gap-4">
        <Skeleton className="size-14 rounded-xl" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-3.5 w-2/3" />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-16 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-72 rounded-xl" />
      <Skeleton className="h-40 rounded-xl" />
    </div>
  );
}

/** Fiche entreprise en panneau latéral (search param `id`). */
export function CompanyDetailSheet({
  id,
  onClose,
  readOnly,
}: {
  id: string | undefined;
  onClose: () => void;
  readOnly: boolean;
}) {
  // Conserve la dernière fiche affichée pendant l'animation de fermeture.
  const [lastId, setLastId] = useState(id);
  useEffect(() => {
    if (id) setLastId(id);
  }, [id]);
  const shownId = id ?? lastId;

  const detail = useCompanyDetail(shownId);
  const remove = useKoraMutation((companyId: string) => api.deleteCompany(companyId), {
    success: "Entreprise retirée du registre",
    onSuccess: onClose,
  });
  const company = detail.data;

  return (
    <KoraSheet
      open={!!id}
      onOpenChange={(open) => !open && onClose()}
      title={company ? `Fiche entreprise ${company.name}` : "Fiche entreprise"}
    >
      {detail.error ? (
        <div className="p-6 pt-12">
          <ErrorPanel
            title="La fiche entreprise n'a pas pu être chargée"
            error={detail.error}
            onRetry={() => void detail.refetch()}
          />
        </div>
      ) : !company ? (
        <SheetSkeleton />
      ) : (
        <>
          <SheetHeader company={company} />
          <div className="kora-scrollbar flex-1 space-y-4 overflow-y-auto px-6 py-5">
            <CompanyEditCard company={company} readOnly={readOnly} />
            <CompanySourcesCard
              companyId={company.id}
              sources={company.sources}
              readOnly={readOnly}
            />
            <CompanySignalsCard companyId={company.id} />
            <section className="flex items-center gap-4 rounded-xl border border-kora-rose/25 bg-kora-rose-bg/40 p-4">
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-kora-ink">
                  Retirer l&apos;entreprise du registre
                </p>
                <p className="mt-0.5 text-[12px] text-kora-ink-soft">
                  Ses sources ne seront plus collectées. L&apos;action est consignée dans le journal
                  d&apos;audit.
                </p>
              </div>
              <ConfirmDialog
                title={`Supprimer « ${company.name} » ?`}
                description={
                  <>
                    La fiche et ses {company.sourceCount} source(s) rattachée(s) seront retirées du
                    registre. Cette action est consignée dans le journal d&apos;audit.
                  </>
                }
                confirmLabel="Supprimer l'entreprise"
                onConfirm={() => remove.mutate(company.id)}
                trigger={
                  <button
                    type="button"
                    disabled={readOnly || remove.isPending}
                    className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border border-kora-rose/35 bg-white px-3.5 text-[13px] font-semibold text-kora-rose transition hover:bg-kora-rose-bg disabled:pointer-events-none disabled:opacity-50"
                  >
                    <Trash2 className="size-4" /> Supprimer
                  </button>
                }
              />
            </section>
          </div>
        </>
      )}
    </KoraSheet>
  );
}
