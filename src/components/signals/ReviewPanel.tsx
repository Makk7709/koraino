import { Link2, Merge, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { GhostButton, PrimaryButton } from "@/components/kora/primitives";
import type { SignalDetail } from "@/lib/api/types";
import { cn } from "@/lib/utils";
import { FilterSelect } from "./FilterSelect";
import { useCompanyOptions, useSignalActions } from "./hooks";

const KIND_LABEL = {
  homonymie: "Homonymie à vérifier",
  fusion_incertaine: "Fusion incertaine",
} as const;

/** Identifiant du sujet proche cité dans la note de revue (ex. « … (sig_0010) … »). */
function relatedSignalId(signal: SignalDetail): string | null {
  const match = signal.review?.note.match(/\b(sig_[\w-]+)\b/);
  return match?.[1] && match[1] !== signal.id ? match[1] : null;
}

/**
 * Alerte de revue humaine : homonymie ou entreprise non rattachée (rattachement manuel),
 * fusion incertaine (regroupement avec le sujet proche ou détachement des observations).
 */
export function ReviewPanel({
  signal,
  onMerged,
  className,
}: {
  signal: SignalDetail;
  /** Appelé avec l'identifiant du signal conservé après un regroupement. */
  onMerged?: (targetId: string) => void;
  className?: string;
}) {
  const actions = useSignalActions();
  const options = useCompanyOptions();
  const [companyId, setCompanyId] = useState<string | undefined>(signal.companyId ?? undefined);
  useEffect(() => setCompanyId(signal.companyId ?? undefined), [signal.id, signal.companyId]);

  const orphanObservations = signal.observations.filter((o) => o.companyId === null).length;
  if (!signal.review && signal.companyId && orphanObservations === 0) return null;

  const canAttach = !signal.companyId || signal.review?.kind === "homonymie";
  const related = signal.review?.kind === "fusion_incertaine" ? relatedSignalId(signal) : null;
  const title = signal.review
    ? KIND_LABEL[signal.review.kind]
    : !signal.companyId
      ? "Entreprise non rattachée"
      : "Observations à rattacher";

  return (
    <section
      role="alert"
      className={cn(
        "rounded-2xl border border-kora-amber/35 bg-[oklch(0.985_0.03_85)] px-4 py-3.5 shadow-[var(--kora-shadow)]",
        className,
      )}
    >
      <p className="flex items-center gap-2 text-[13.5px] font-bold text-kora-ink">
        <TriangleAlert className="size-4 text-kora-amber" />
        {title}
      </p>
      <p className="mt-1 text-[12.5px] leading-snug text-kora-ink-soft">
        {signal.review?.note ??
          (signal.companyId
            ? `${orphanObservations} observation(s) n'ont pas pu être attribuées avec certitude : détachez-les si elles concernent une autre entreprise.`
            : "Aucune entreprise du registre n'a été attribuée avec certitude à ce signal.")}
      </p>
      {signal.review?.kind === "fusion_incertaine" && (
        <p className="mt-1 text-[11.5px] text-muted-foreground">
          {related
            ? "Regroupez-le avec ce sujet s'il s'agit du même événement ; sinon, détachez les observations concernées ci-dessous."
            : "Si les observations décrivent des événements distincts, détachez-les ci-dessous."}
        </p>
      )}
      {canAttach && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <FilterSelect
            label="Entreprise de rattachement"
            value={companyId}
            onValueChange={setCompanyId}
            options={options}
            allLabel="Choisir une entreprise…"
            className="min-w-[13rem] flex-1"
          />
          <PrimaryButton
            className="h-8 px-3 text-[12px]"
            disabled={
              !companyId || companyId === signal.companyId || actions.attachCompany.isPending
            }
            onClick={() =>
              companyId && actions.attachCompany.mutate({ signalId: signal.id, companyId })
            }
          >
            <Link2 className="size-3.5" />
            Rattacher
          </PrimaryButton>
        </div>
      )}
      {related && (
        <GhostButton
          className="mt-3 h-8 px-3 text-[12px]"
          disabled={actions.merge.isPending}
          onClick={() =>
            actions.merge.mutate(
              { targetId: related, otherIds: [signal.id] },
              { onSuccess: () => onMerged?.(related) },
            )
          }
        >
          <Merge className="size-3.5" />
          Regrouper avec ce sujet
        </GhostButton>
      )}
    </section>
  );
}
