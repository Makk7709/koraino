import { Plus, Radio, ShieldAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { GhostButton, PrimaryButton } from "@/components/kora/primitives";
import { SOURCE_TYPE } from "@/components/kora/labels";
import { ApiError, api } from "@/lib/api/client";
import { errorMessage, useCompanies, useKoraMutation } from "@/lib/api/hooks";
import type { SourceFrequency, SourceInput, SourceType } from "@/lib/api/types";
import { cn } from "@/lib/utils";
import { Field, InlineError, KoraDialog, Notice, fieldClass } from "./kit";
import { FREQUENCY_OPTIONS, SOURCE_TYPE_OPTIONS } from "./labels";

interface FormState {
  companyId: string;
  type: SourceType;
  label: string;
  url: string;
  frequency: SourceFrequency;
}

const initial = (companyId?: string): FormState => ({
  companyId: companyId ?? "",
  type: "actualites",
  label: "",
  url: "",
  frequency: "quotidienne",
});

function urlProblem(url: string): string | null {
  const v = url.trim();
  if (!v) return "L'URL est obligatoire.";
  if (!/^https?:\/\//i.test(v))
    return "Saisissez une URL complète commençant par https:// ou http://.";
  try {
    new URL(v);
    return null;
  } catch {
    return "Cette URL n'est pas valide.";
  }
}

function serverErrorTitle(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === "url_refused") return "URL refusée par le serveur";
    if (e.code.includes("quota")) return "Quota de sources atteint";
    if (e.status === 403) return "Action non autorisée pour votre profil";
  }
  return "Création impossible";
}

export function AddSourceDialog({
  open,
  onOpenChange,
  companyId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Entreprise présélectionnée (ajout depuis une fiche entreprise). */
  companyId?: string;
}) {
  const companies = useCompanies();
  const [form, setForm] = useState<FormState>(() => initial(companyId));
  const [submitted, setSubmitted] = useState(false);
  const create = useKoraMutation((input: SourceInput) => api.createSource(input), {
    success: (s) => `Source « ${s.label} » ajoutée au registre`,
    onSuccess: () => onOpenChange(false),
  });
  const resetMutation = create.reset;

  useEffect(() => {
    if (!open) return;
    setForm(initial(companyId));
    setSubmitted(false);
    resetMutation();
  }, [open, companyId, resetMutation]);

  const sorted = useMemo(
    () => [...(companies.data ?? [])].sort((a, b) => a.name.localeCompare(b.name, "fr")),
    [companies.data],
  );
  const company = sorted.find((c) => c.id === form.companyId);

  const urlRefused = create.error instanceof ApiError && create.error.code === "url_refused";
  const errors = {
    companyId: form.companyId ? null : "Choisissez l'entreprise rattachée.",
    label: form.label.trim() ? null : "Le libellé est obligatoire.",
    url: urlProblem(form.url) ?? (urlRefused ? "URL refusée : voir le motif ci-dessous." : null),
  };
  const show = (k: keyof typeof errors) => (submitted ? errors[k] : null);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    if (k === "url" && create.error) resetMutation();
  };

  const submit = () => {
    setSubmitted(true);
    if (errors.companyId || errors.label || urlProblem(form.url)) return;
    create.mutate({
      companyId: form.companyId,
      type: form.type,
      label: form.label.trim(),
      url: form.url.trim(),
      frequency: form.frequency,
    });
  };

  return (
    <KoraDialog
      open={open}
      onOpenChange={onOpenChange}
      icon={Radio}
      tone="teal"
      title="Ajouter une source"
      description="Site officiel, page d'actualités, communiqués, flux RSS ou recherche web rattachés à une entreprise du registre."
      onSubmit={submit}
      footer={
        <>
          <GhostButton onClick={() => onOpenChange(false)}>Annuler</GhostButton>
          <PrimaryButton type="submit" disabled={create.isPending}>
            <Plus className="size-4" />
            {create.isPending ? "Vérification…" : "Ajouter la source"}
          </PrimaryButton>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-x-4 gap-y-3.5">
        <Field label="Entreprise" required error={show("companyId")} className="col-span-2">
          <Select value={form.companyId} onValueChange={(v) => set("companyId", v)}>
            <SelectTrigger
              aria-label="Entreprise"
              className={cn(fieldClass, "h-9", show("companyId") && "border-kora-rose/60")}
            >
              <SelectValue
                placeholder={
                  companies.isPending ? "Chargement du registre…" : "Choisir une entreprise"
                }
              />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {sorted.map((c) => (
                <SelectItem key={c.id} value={c.id} className="text-[13px]">
                  {c.name}
                  <span className="ml-1.5 text-[11px] text-muted-foreground">{c.domain}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label="Type de source" required>
          <Select value={form.type} onValueChange={(v) => set("type", v as SourceType)}>
            <SelectTrigger aria-label="Type de source" className={cn(fieldClass, "h-9")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SOURCE_TYPE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value} className="text-[13px]">
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field
          label="Fréquence de collecte"
          hint="1 collecte planifiée par source et par jour au plus."
        >
          <Select
            value={form.frequency}
            onValueChange={(v) => set("frequency", v as SourceFrequency)}
          >
            <SelectTrigger aria-label="Fréquence" className={cn(fieldClass, "h-9")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FREQUENCY_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value} className="text-[13px]">
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field
          label="Libellé"
          htmlFor="source-label"
          required
          error={show("label")}
          className="col-span-2"
        >
          <Input
            id="source-label"
            value={form.label}
            onChange={(e) => set("label", e.target.value)}
            placeholder={`ex. ${SOURCE_TYPE[form.type]}${company ? ` ${company.name}` : ""}`}
            className={cn(fieldClass, show("label") && "border-kora-rose/60")}
          />
        </Field>

        <Field label="URL" htmlFor="source-url" required error={show("url")} className="col-span-2">
          <Input
            id="source-url"
            type="url"
            inputMode="url"
            value={form.url}
            onChange={(e) => set("url", e.target.value)}
            placeholder={company ? `https://www.${company.domain}/actualites` : "https://"}
            className={cn(
              fieldClass,
              "font-mono text-[12px] md:text-[12px]",
              show("url") && "border-kora-rose/60",
            )}
          />
        </Field>
      </div>

      <div className="mt-4 space-y-2.5">
        {create.error ? (
          <InlineError title={serverErrorTitle(create.error)}>
            {errorMessage(create.error)}
            {urlRefused && (
              <span className="mt-1 block">
                Les adresses internes, les protocoles autres que http(s) et tout contournement
                d&apos;accès ou d&apos;autorisation sont refusés (protection SSRF).
              </span>
            )}
          </InlineError>
        ) : null}
        <Notice tone="gray" icon={ShieldAlert}>
          Seules les sources publiques accessibles sont collectées : aucun contournement
          d&apos;accès, de protection ou d&apos;autorisation n&apos;est effectué. Une source payante
          ou une boîte mail relève d&apos;un périmètre distinct.
        </Notice>
      </div>
    </KoraDialog>
  );
}
