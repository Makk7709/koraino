import { Mail, Plus } from "lucide-react";
import { useState } from "react";
import { GhostButton, PrimaryButton } from "@/components/kora/primitives";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api/client";
import { useKoraMutation } from "@/lib/api/hooks";
import type { NewsletterEdition } from "@/lib/api/types";
import { DialogBody, DialogFooterBar, KoraDialog } from "@/components/articles/KoraDialog";
import { Field, inputClass } from "@/components/articles/ui";

/** Lundi suivant (date locale, format AAAA-MM-JJ). */
function nextMonday(): string {
  const d = new Date();
  d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function NewEditionForm({
  onCreated,
  onCancel,
}: {
  onCreated: (edition: NewsletterEdition) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [weekOf, setWeekOf] = useState(nextMonday);
  const create = useKoraMutation(
    () =>
      api.createNewsletter({
        ...(title.trim() ? { title: title.trim() } : {}),
        ...(weekOf ? { weekOf } : {}),
      }),
    { success: (e) => `Édition « ${e.title} » créée`, onSuccess: onCreated },
  );
  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate(undefined);
      }}
    >
      <DialogBody className="flex flex-col gap-3.5">
        <Field label="Titre" htmlFor="nl-title" hint="Laissez vide pour un titre proposé par KORA.">
          <Input
            id="nl-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="La semaine de l'écosystème Inovallée"
            className={inputClass}
          />
        </Field>
        <Field label="Semaine du" htmlFor="nl-week">
          <Input
            id="nl-week"
            type="date"
            value={weekOf}
            onChange={(e) => setWeekOf(e.target.value)}
            className={inputClass}
          />
        </Field>
      </DialogBody>
      <DialogFooterBar note="L'édition démarre en composition ; elle devra être approuvée avant export.">
        <GhostButton type="button" onClick={onCancel}>
          Annuler
        </GhostButton>
        <PrimaryButton type="submit" disabled={create.isPending}>
          <Plus className="size-4" /> {create.isPending ? "Création…" : "Créer l'édition"}
        </PrimaryButton>
      </DialogFooterBar>
    </form>
  );
}

export function NewEditionDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (edition: NewsletterEdition) => void;
}) {
  return (
    <KoraDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Nouvelle édition"
      description="Composez une nouvelle newsletter hebdomadaire."
      icon={<Mail className="mt-0.5 size-5 text-kora-teal" />}
    >
      <NewEditionForm
        onCancel={() => onOpenChange(false)}
        onCreated={(e) => {
          onOpenChange(false);
          onCreated(e);
        }}
      />
    </KoraDialog>
  );
}
