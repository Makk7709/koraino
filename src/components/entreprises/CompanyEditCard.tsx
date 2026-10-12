import { Save, Undo2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { GhostButton, KoraCard, PrimaryButton } from "@/components/kora/primitives";
import { formatDate } from "@/components/kora/labels";
import { InlineError } from "@/components/veille/kit";
import { api } from "@/lib/api/client";
import { errorMessage, useKoraMutation } from "@/lib/api/hooks";
import type { Company, CompanyInput } from "@/lib/api/types";
import { CompanyFields } from "./CompanyForm";
import {
  fromCompany,
  toCompanyInput,
  validateCompany,
  type CompanyFormValues,
} from "./companyFormModel";

/** Fiche registre éditable (raison sociale, alias, domaine, secteur, territoire, priorité). */
export function CompanyEditCard({ company, readOnly }: { company: Company; readOnly: boolean }) {
  // Ne réinitialise le formulaire que si la fiche a réellement changé côté serveur
  // (les invalidations globales du cache ne doivent pas effacer une saisie en cours).
  const snapshot = JSON.stringify(fromCompany(company));
  const initial = useMemo(() => JSON.parse(snapshot) as CompanyFormValues, [snapshot]);
  const [values, setValues] = useState<CompanyFormValues>(initial);
  const [submitted, setSubmitted] = useState(false);
  const update = useKoraMutation(
    (input: Partial<CompanyInput>) => api.updateCompany(company.id, input),
    { success: (c) => `Fiche « ${c.name} » mise à jour` },
  );
  const resetMutation = update.reset;

  useEffect(() => {
    setValues(initial);
    setSubmitted(false);
    resetMutation();
  }, [initial, resetMutation]);

  const dirty = JSON.stringify(values) !== JSON.stringify(initial);
  const errors = submitted ? validateCompany(values) : {};

  const save = () => {
    setSubmitted(true);
    if (Object.keys(validateCompany(values)).length > 0) return;
    update.mutate(toCompanyInput(values));
  };

  return (
    <KoraCard
      title="Fiche registre"
      action={
        <span className="text-[11px] text-muted-foreground">
          Créée le {formatDate(company.createdAt)}
        </span>
      }
    >
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <fieldset disabled={readOnly} className="space-y-4">
          <CompanyFields
            value={values}
            onChange={setValues}
            errors={errors}
            idPrefix={`company-${company.id}`}
          />
          {update.error ? (
            <InlineError title="Mise à jour refusée">{errorMessage(update.error)}</InlineError>
          ) : null}
          <div className="flex items-center justify-end gap-2 border-t border-border/70 pt-3">
            {dirty && (
              <span className="mr-auto text-[11px] text-kora-amber">
                Modifications non enregistrées
              </span>
            )}
            <GhostButton disabled={!dirty || update.isPending} onClick={() => setValues(initial)}>
              <Undo2 className="size-4" /> Annuler
            </GhostButton>
            <PrimaryButton type="submit" disabled={!dirty || update.isPending}>
              <Save className="size-4" />
              {update.isPending ? "Enregistrement…" : "Enregistrer"}
            </PrimaryButton>
          </div>
        </fieldset>
      </form>
    </KoraCard>
  );
}
