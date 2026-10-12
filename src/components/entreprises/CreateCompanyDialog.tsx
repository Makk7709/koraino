import { Building2, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { GhostButton, PrimaryButton } from "@/components/kora/primitives";
import { InlineError, KoraDialog, Notice } from "@/components/veille/kit";
import { ApiError, api } from "@/lib/api/client";
import { errorMessage, useKoraMutation } from "@/lib/api/hooks";
import type { Company, CompanyInput } from "@/lib/api/types";
import { CompanyFields } from "./CompanyForm";
import {
  EMPTY_COMPANY,
  toCompanyInput,
  validateCompany,
  type CompanyFormValues,
} from "./companyFormModel";

function errorTitle(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code.includes("quota")) return "Quota d'entreprises atteint";
    if (e.status === 409) return "Entreprise déjà présente dans le registre";
    if (e.status === 403) return "Action non autorisée pour votre profil";
    if (e.status === 422) return "Fiche refusée par le serveur";
  }
  return "Création impossible";
}

export function CreateCompanyDialog({
  open,
  onOpenChange,
  quota,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  quota: { used: number; limit: number } | null;
  onCreated: (company: Company) => void;
}) {
  const [values, setValues] = useState<CompanyFormValues>(EMPTY_COMPANY);
  const [submitted, setSubmitted] = useState(false);
  const create = useKoraMutation((input: CompanyInput) => api.createCompany(input), {
    success: (c) => `Entreprise « ${c.name} » ajoutée au registre`,
    onSuccess: (c) => {
      onOpenChange(false);
      onCreated(c);
    },
  });
  const resetMutation = create.reset;

  useEffect(() => {
    if (!open) return;
    setValues(EMPTY_COMPANY);
    setSubmitted(false);
    resetMutation();
  }, [open, resetMutation]);

  const errors = submitted ? validateCompany(values) : {};
  const full = quota !== null && quota.used >= quota.limit;

  const submit = () => {
    setSubmitted(true);
    if (Object.keys(validateCompany(values)).length > 0) return;
    create.mutate(toCompanyInput(values));
  };

  return (
    <KoraDialog
      open={open}
      onOpenChange={onOpenChange}
      icon={Building2}
      tone="teal"
      title="Ajouter une entreprise"
      description="Nouvelle fiche du registre KORA Radar. Les sources se rattachent ensuite depuis la fiche."
      onSubmit={submit}
      className="max-w-xl"
      footer={
        <>
          <GhostButton onClick={() => onOpenChange(false)}>Annuler</GhostButton>
          <PrimaryButton type="submit" disabled={create.isPending}>
            <Plus className="size-4" />
            {create.isPending ? "Création…" : "Ajouter au registre"}
          </PrimaryButton>
        </>
      }
    >
      <div className="space-y-4">
        {full && (
          <Notice tone="amber" title={`Quota de ${quota.limit} entreprises atteint`}>
            Le serveur refusera la création tant qu&apos;une fiche n&apos;est pas retirée ou que le
            quota n&apos;est pas étendu.
          </Notice>
        )}
        <CompanyFields value={values} onChange={setValues} errors={errors} idPrefix="new-company" />
        {create.error ? (
          <InlineError title={errorTitle(create.error)}>{errorMessage(create.error)}</InlineError>
        ) : null}
      </div>
    </KoraDialog>
  );
}
