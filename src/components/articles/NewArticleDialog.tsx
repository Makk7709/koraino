import { Check, Lightbulb, Sparkles } from "lucide-react";
import { useState } from "react";
import { BrandMark } from "@/components/kora/BrandMark";
import {
  ConfidenceBadge,
  EmptyState,
  GhostButton,
  Pill,
  PrimaryButton,
  ScorePill,
  StatusPill,
} from "@/components/kora/primitives";
import { formatDate } from "@/components/kora/labels";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api/client";
import { useKoraMutation, useSignals } from "@/lib/api/hooks";
import type { Company, Signal } from "@/lib/api/types";
import { cn } from "@/lib/utils";
import { DialogBody, DialogFooterBar, KoraDialog } from "./KoraDialog";
import { ListSkeleton, LoadError, SkyPanel, inputClass } from "./ui";
import { useSetArticle } from "./workflow";

type AngleMode = "suggere" | "libre" | "kora";

function SignalRow({
  signal,
  company,
  selected,
  onSelect,
}: {
  signal: Signal;
  company: Company | undefined;
  selected: boolean;
  onSelect: () => void;
}) {
  const taken = signal.articleId !== null;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={taken}
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition disabled:cursor-not-allowed disabled:opacity-55",
        selected
          ? "border-kora-blue/35 bg-kora-blue-bg/70"
          : "border-border bg-white hover:border-kora-teal-light",
      )}
    >
      <span
        className={cn(
          "inline-flex size-4 shrink-0 items-center justify-center rounded border",
          selected ? "border-kora-blue bg-kora-blue text-white" : "border-input bg-white",
        )}
      >
        {selected && <Check className="size-3" strokeWidth={3} />}
      </span>
      {company ? (
        <BrandMark name={company.name} brand={company.brand} domain={company.domain} size="md" />
      ) : (
        <span className="size-10 shrink-0 rounded-lg bg-muted" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[12.5px] font-bold text-kora-ink">
            {company?.name ?? "Entreprise à rattacher"}
          </span>
          <ConfidenceBadge value={signal.matchConfidence} />
          {taken && (
            <Pill tone="gray" size="sm">
              Article déjà créé
            </Pill>
          )}
        </div>
        <p className="mt-0.5 line-clamp-1 text-[13px] font-semibold text-kora-ink">
          {signal.title}
        </p>
        <p className="text-[11px] text-muted-foreground">
          {signal.primaryOutlet.name} · {formatDate(signal.publishedAt ?? signal.eventDate)}
        </p>
      </div>
      <ScorePill total={signal.score.total} />
      <StatusPill status={signal.status} />
    </button>
  );
}

function NewArticleForm({
  companies,
  onCreated,
  onCancel,
}: {
  companies: Map<string, Company>;
  onCreated: (id: string) => void;
  onCancel: () => void;
}) {
  const signals = useSignals({ sort: "score", limit: 100 });
  const candidates = (signals.data?.items ?? [])
    .filter((s) => s.status === "nouveau" || s.status === "a_traiter")
    .sort((a, b) => b.score.total - a.score.total);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<AngleMode>("suggere");
  const [custom, setCustom] = useState("");
  const selected = candidates.find((s) => s.id === selectedId) ?? null;
  const setArticle = useSetArticle();
  const create = useKoraMutation(
    (v: { signalId: string; angle: string | undefined }) =>
      api.createArticleFromSignal(v.signalId, v.angle),
    {
      success: "Dossier factuel, angles et brouillon sourcé préparés",
      onSuccess: (a) => {
        setArticle(a);
        onCreated(a.id);
      },
    },
  );
  const angle =
    mode === "suggere"
      ? selected?.suggestedAngle.text
      : mode === "libre"
        ? custom.trim()
        : undefined;
  const invalid = !selected || (mode === "libre" && !custom.trim());

  return (
    <>
      <DialogBody className="flex flex-col gap-4">
        <div>
          <p className="mb-2 text-[12px] font-semibold text-kora-ink-soft">
            Sujets à traiter, triés par score éditorial
          </p>
          {signals.isPending ? (
            <ListSkeleton rows={4} />
          ) : signals.isError ? (
            <LoadError error={signals.error} onRetry={() => void signals.refetch()} />
          ) : candidates.length === 0 ? (
            <EmptyState title="Aucun signal nouveau ou à traiter">
              Les sujets sélectionnés apparaîtront ici après la prochaine collecte.
            </EmptyState>
          ) : (
            <div role="radiogroup" className="flex flex-col gap-1.5">
              {candidates.map((s) => (
                <SignalRow
                  key={s.id}
                  signal={s}
                  company={s.companyId ? companies.get(s.companyId) : undefined}
                  selected={s.id === selectedId}
                  onSelect={() => setSelectedId(s.id)}
                />
              ))}
            </div>
          )}
        </div>

        {selected && (
          <SkyPanel title="Angle éditorial" icon={Lightbulb}>
            <div role="radiogroup" className="flex flex-col gap-2 text-[12.5px] text-kora-ink-soft">
              {(
                [
                  ["suggere", `Angle suggéré : « ${selected.suggestedAngle.text} »`],
                  ["libre", "Autre angle"],
                  ["kora", "Laisser KORA proposer plusieurs angles"],
                ] as const
              ).map(([value, label]) => (
                <label key={value} className="flex cursor-pointer items-start gap-2">
                  <input
                    type="radio"
                    name="angle"
                    checked={mode === value}
                    onChange={() => setMode(value)}
                    className="mt-0.5 accent-kora-teal"
                  />
                  <span className={cn(mode === value && "font-semibold text-kora-ink")}>
                    {label}
                  </span>
                </label>
              ))}
              {mode === "libre" && (
                <Input
                  autoFocus
                  value={custom}
                  onChange={(e) => setCustom(e.target.value)}
                  placeholder="Ex. Ce que la levée change pour l'emploi à Grenoble"
                  className={inputClass}
                />
              )}
            </div>
            {selected.suggestedAngle.tags.length > 0 && mode === "suggere" && (
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {selected.suggestedAngle.tags.map((t, i) => (
                  <Pill key={t} tone={i % 2 === 0 ? "purple" : "blue"} size="sm">
                    {t}
                  </Pill>
                ))}
              </div>
            )}
          </SkyPanel>
        )}
      </DialogBody>
      <DialogFooterBar note="Les faits sont reliés aux sources du dossier ; les éléments non corroborés sont marqués [À vérifier].">
        <GhostButton onClick={onCancel}>Annuler</GhostButton>
        <PrimaryButton
          disabled={invalid || create.isPending}
          onClick={() =>
            selected && create.mutate({ signalId: selected.id, angle: angle || undefined })
          }
        >
          <Sparkles className="size-4" />
          {create.isPending ? "Préparation…" : "Préparer le dossier et le brouillon"}
        </PrimaryButton>
      </DialogFooterBar>
    </>
  );
}

export function NewArticleDialog({
  open,
  onOpenChange,
  companies,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companies: Map<string, Company>;
  onCreated: (id: string) => void;
}) {
  return (
    <KoraDialog
      open={open}
      onOpenChange={onOpenChange}
      size="xl"
      title="Nouvel article depuis un signal"
      description="Après votre sélection, KORA prépare un dossier factuel, des angles, un titre, un chapô, un plan et un brouillon sourcé."
      icon={
        <span className="mt-0.5 inline-flex size-8 items-center justify-center rounded-lg bg-kora-teal-bg text-kora-teal">
          <Sparkles className="size-4" />
        </span>
      }
    >
      <NewArticleForm
        companies={companies}
        onCancel={() => onOpenChange(false)}
        onCreated={(id) => {
          onOpenChange(false);
          onCreated(id);
        }}
      />
    </KoraDialog>
  );
}
