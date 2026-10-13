import { CheckCircle2, RotateCcw } from "lucide-react";
import { Banner } from "@/components/articles/ui";
import { GhostButton, PrimaryButton } from "@/components/kora/primitives";
import { formatDateTime } from "@/components/kora/labels";
import { ConfirmDialog } from "@/components/veille/kit";
import type { LinkedInPublishInput, PublicationAttempt } from "@/lib/api/types";

/** Tentative posée par le serveur juste avant l'appel LinkedIn, jamais complétée. */
const CONFIRMATION_PENDING = "linkedin_confirmation_pending";

type Resolution = NonNullable<LinkedInPublishInput["resolution"]>;

/**
 * Publication au résultat inconnu (coupure, erreur LinkedIn ambiguë, serveur interrompu) :
 * KORA refuse de republier tant qu'un humain n'a pas vérifié le fil LinkedIn.
 */
export function UnconfirmedPublication({
  attempt,
  disabledReason,
  pending,
  onResolve,
}: {
  attempt: PublicationAttempt;
  disabledReason: string | null;
  pending: boolean;
  onResolve: (resolution: Resolution) => void;
}) {
  const disabled = !!disabledReason || pending;
  const title = disabledReason ?? undefined;
  return (
    <Banner tone="warning" title="Publication LinkedIn à vérifier">
      <p className="font-medium">
        Publication lancée par {attempt.by} le {formatDateTime(attempt.at)}.
      </p>
      <p className="mt-1">
        {attempt.code === CONFIRMATION_PENDING
          ? "KORA n'a pas reçu la confirmation de LinkedIn pour cette publication. Si elle vient d'être lancée, patientez quelques secondes puis actualisez."
          : attempt.message}
      </p>
      <p className="mt-1">
        Ouvrez le fil LinkedIn du compte de {attempt.by}, puis indiquez à KORA si le post y figure.
        Aucune nouvelle publication de la version {attempt.version} n&apos;est possible en
        attendant. « Republier » publiera depuis le compte LinkedIn relié de la personne qui clique.
      </p>
      <div className="mt-2.5 flex flex-wrap gap-2">
        <PrimaryButton disabled={disabled} title={title} onClick={() => onResolve("published")}>
          <CheckCircle2 className="size-4" /> Le post est bien sur LinkedIn
        </PrimaryButton>
        <ConfirmDialog
          trigger={
            <GhostButton disabled={disabled} title={title}>
              <RotateCcw className="size-4" /> Le post n&apos;y est pas : republier
            </GhostButton>
          }
          title="Republier ce post sur LinkedIn ?"
          description={`Confirmez seulement après avoir vérifié le fil LinkedIn : si le post y figure déjà, il sera publié une seconde fois, publiquement. La nouvelle publication partira de votre compte LinkedIn relié, pas forcément de celui de ${attempt.by} (sans compte relié : export manuel).`}
          confirmLabel="Republier"
          onConfirm={() => onResolve("not_published")}
        />
      </div>
      {disabledReason && (
        <p className="mt-1.5 text-[11px] text-muted-foreground">{disabledReason}</p>
      )}
    </Banner>
  );
}
