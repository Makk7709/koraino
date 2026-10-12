import { Gavel } from "lucide-react";
import { useState } from "react";
import { GhostButton, PrimaryButton } from "@/components/kora/primitives";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api/client";
import { useKoraMutation } from "@/lib/api/hooks";
import type { ArticleDetail, FactCheck } from "@/lib/api/types";
import { cn } from "@/lib/utils";
import { DialogBody, DialogFooterBar, KoraDialog } from "./KoraDialog";
import { Field, inputClass } from "./ui";
import { useSetArticle } from "./workflow";

type Verdict = "etaye" | "non_corrobore";

const VERDICTS: { value: Verdict; label: string; detail: string; tone: string }[] = [
  {
    value: "etaye",
    label: "Étayé",
    detail: "Après vérification, l'assertion est confirmée par une source fiable.",
    tone: "border-kora-green/30 bg-kora-green-bg/60",
  },
  {
    value: "non_corrobore",
    label: "Non corroboré",
    detail:
      "L'assertion reste à vérifier : elle doit rester signalée « [À vérifier] » ou être retirée.",
    tone: "border-kora-amber/35 bg-kora-amber-bg/60",
  },
];

function ArbitrationForm({
  article,
  factCheck,
  onDone,
}: {
  article: ArticleDetail;
  factCheck: FactCheck;
  onDone: () => void;
}) {
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [note, setNote] = useState("");
  const setArticle = useSetArticle();
  const resolve = useKoraMutation(
    (v: Verdict) =>
      api.resolveFactCheck(article.id, factCheck.id, { status: v, note: note.trim() || null }),
    {
      success: "Arbitrage enregistré dans le dossier factuel",
      onSuccess: (a) => {
        setArticle(a);
        onDone();
      },
    },
  );

  return (
    <>
      <DialogBody className="flex flex-col gap-3.5">
        <blockquote className="rounded-xl border border-kora-rose/20 bg-kora-rose-bg/40 px-3.5 py-2.5 text-[13px] leading-snug font-medium text-kora-ink">
          « {factCheck.claim} »
        </blockquote>
        <div role="radiogroup" aria-label="Verdict" className="grid gap-2 sm:grid-cols-2">
          {VERDICTS.map((v) => (
            <button
              key={v.value}
              type="button"
              role="radio"
              aria-checked={verdict === v.value}
              onClick={() => setVerdict(v.value)}
              className={cn(
                "rounded-xl border p-3 text-left transition",
                verdict === v.value
                  ? cn(v.tone, "ring-1 ring-kora-teal-light")
                  : "border-border bg-white hover:border-kora-teal-light",
              )}
            >
              <p className="text-[13px] font-bold text-kora-ink">{v.label}</p>
              <p className="mt-0.5 text-[12px] leading-snug text-kora-ink-soft">{v.detail}</p>
            </button>
          ))}
        </div>
        <Field
          label="Justification"
          htmlFor="fc-note"
          hint="Conservée dans le dossier et le journal : source consultée, contact, contexte…"
        >
          <Textarea
            id="fc-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder="Ex. : montant confirmé par le communiqué officiel du 12 octobre."
            className={inputClass}
          />
        </Field>
      </DialogBody>
      <DialogFooterBar note="L'arbitrage est tracé (auteur, date, justification) et lève le blocage d'approbation.">
        <GhostButton onClick={onDone}>Annuler</GhostButton>
        <PrimaryButton
          disabled={!verdict || resolve.isPending}
          onClick={() => verdict && resolve.mutate(verdict)}
        >
          <Gavel className="size-4" /> Enregistrer l&apos;arbitrage
        </PrimaryButton>
      </DialogFooterBar>
    </>
  );
}

export function FactCheckDialog({
  article,
  factCheck,
  onClose,
}: {
  article: ArticleDetail;
  factCheck: FactCheck | null;
  onClose: () => void;
}) {
  return (
    <KoraDialog
      open={!!factCheck}
      onOpenChange={(o) => !o && onClose()}
      size="lg"
      title="Arbitrer une assertion"
      description="Les sources du dossier se contredisent : tranchez après vérification humaine."
      icon={<Gavel className="mt-0.5 size-5 text-kora-rose" />}
    >
      {factCheck && <ArbitrationForm article={article} factCheck={factCheck} onDone={onClose} />}
    </KoraDialog>
  );
}
