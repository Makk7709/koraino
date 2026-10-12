import { ArrowLeftRight, GitCompareArrows, History, RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";
import { GhostButton, Pill, PrimaryButton } from "@/components/kora/primitives";
import { formatDateTime } from "@/components/kora/labels";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api/client";
import { useKoraMutation } from "@/lib/api/hooks";
import type { ArticleDetail, ArticleVersion } from "@/lib/api/types";
import { cn } from "@/lib/utils";
import { DiffLegend, DiffParts } from "./DiffText";
import { diffWords, hasChanges } from "./diff";
import { DialogBody, DialogFooterBar, KoraDialog } from "./KoraDialog";
import { Banner, SectionTitle } from "./ui";
import { useSetArticle } from "./workflow";

const FIELDS: { key: keyof ArticleVersion; label: string }[] = [
  { key: "title", label: "Titre" },
  { key: "chapo", label: "Chapô" },
  { key: "body", label: "Corps" },
  { key: "excerpt", label: "Extrait" },
  { key: "seoTitle", label: "Titre SEO" },
  { key: "categories", label: "Catégories" },
  { key: "tags", label: "Tags" },
];

function fieldText(v: ArticleVersion, key: keyof ArticleVersion): string {
  const value = v[key];
  if (Array.isArray(value)) return value.join(", ");
  return value === null ? "" : String(value);
}

function VersionCompare({ from, to }: { from: ArticleVersion; to: ArticleVersion }) {
  const diffs = useMemo(
    () =>
      FIELDS.map((f) => ({
        ...f,
        parts: diffWords(fieldText(from, f.key), fieldText(to, f.key)),
      })).filter((d) => hasChanges(d.parts)),
    [from, to],
  );
  if (!diffs.length)
    return (
      <p className="rounded-xl border border-dashed bg-white/60 px-4 py-6 text-center text-[12.5px] text-muted-foreground">
        Aucune différence textuelle entre la version {from.n} et la version {to.n}.
      </p>
    );
  return (
    <div className="flex flex-col gap-3">
      {diffs.map((d) => (
        <div key={d.key} className="rounded-xl border border-border bg-white p-3.5">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-[12px] font-bold tracking-wide text-kora-ink-soft uppercase">
              {d.label}
            </p>
            <DiffLegend parts={d.parts} />
          </div>
          <DiffParts
            parts={d.parts}
            className={cn(d.key === "body" && "kora-scrollbar max-h-[520px] overflow-y-auto pr-1")}
          />
        </div>
      ))}
    </div>
  );
}

function VersionSelect({
  label,
  value,
  versions,
  onChange,
}: {
  label: string;
  value: number;
  versions: ArticleVersion[];
  onChange: (n: number) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-[12px] text-kora-ink-soft">
      {label}
      <Select value={String(value)} onValueChange={(v) => onChange(Number(v))}>
        <SelectTrigger className="h-8 w-[150px] rounded-lg border-border bg-white text-[12.5px] text-kora-ink">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {[...new Map(versions.map((v) => [v.n, v])).values()].map((v) => (
            <SelectItem key={v.n} value={String(v.n)} className="text-[12.5px]">
              Version {v.n}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}

/** Historique des versions, comparaison mot à mot et restauration. */
export function VersionsPanel({
  article,
  canWrite,
  dirty,
}: {
  article: ArticleDetail;
  canWrite: boolean;
  dirty: boolean;
}) {
  const versions = useMemo(
    () => [...article.versions].sort((a, b) => b.n - a.n),
    [article.versions],
  );
  const current = article.currentVersion;
  const previous = versions.find((v) => v.n < current)?.n ?? current;
  const [chosen, setChosen] = useState<{ from: number; to: number } | null>(null);
  const pair = chosen ?? { from: previous, to: current };
  const setPair = (update: (p: { from: number; to: number }) => { from: number; to: number }) =>
    setChosen(update(pair));
  const [restoreTarget, setRestoreTarget] = useState<ArticleVersion | null>(null);
  const setArticle = useSetArticle();
  const restore = useKoraMutation((n: number) => api.restoreArticleVersion(article.id, n), {
    success: (a) => `Version restaurée : nouvelle version ${a.currentVersion} à faire approuver`,
    onSuccess: (a) => {
      setArticle(a);
      setRestoreTarget(null);
      setChosen(null);
    },
  });

  const from = versions.find((v) => v.n === pair.from);
  const to = versions.find((v) => v.n === pair.to);
  const approved = article.approvals.some((a) => a.valid);

  return (
    <div className="grid gap-5 min-[1400px]:grid-cols-[300px_minmax(0,1fr)]">
      <section>
        <SectionTitle icon={History}>Historique ({versions.length})</SectionTitle>
        <ol className="relative flex flex-col gap-2 before:absolute before:top-3 before:bottom-3 before:left-[17px] before:w-px before:bg-border">
          {versions.map((v, i) => {
            const isCurrent = v.n === current;
            return (
              <li
                key={`${v.n}-${i}`}
                className={cn(
                  "relative flex gap-3 rounded-xl border p-2.5",
                  isCurrent
                    ? "border-kora-teal-light/60 bg-kora-teal-bg/60"
                    : "border-border bg-white/80",
                )}
              >
                <span
                  className={cn(
                    "relative z-[1] inline-flex size-[22px] shrink-0 items-center justify-center rounded-full text-[10px] font-bold tabular-nums",
                    isCurrent
                      ? "bg-kora-teal text-white"
                      : "bg-muted text-kora-ink-soft ring-1 ring-border",
                  )}
                >
                  {v.n}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="text-[12.5px] font-semibold text-kora-ink">Version {v.n}</p>
                    {isCurrent && (
                      <Pill tone="teal" size="sm">
                        Courante
                      </Pill>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    {v.createdBy} · {formatDateTime(v.createdAt)}
                  </p>
                  {v.note && (
                    <p className="mt-1 text-[11.5px] leading-snug text-kora-ink-soft italic">
                      « {v.note} »
                    </p>
                  )}
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {!isCurrent && (
                      <button
                        type="button"
                        onClick={() => setChosen({ from: v.n, to: current })}
                        className="inline-flex items-center gap-1 text-[11px] font-medium text-kora-teal hover:text-kora-teal-dark"
                      >
                        <GitCompareArrows className="size-3" /> Comparer à la courante
                      </button>
                    )}
                    {!isCurrent && canWrite && (
                      <button
                        type="button"
                        disabled={dirty}
                        title={
                          dirty ? "Enregistrez ou annulez vos modifications d'abord." : undefined
                        }
                        onClick={() => setRestoreTarget(v)}
                        className="inline-flex items-center gap-1 text-[11px] font-medium text-kora-ink-soft hover:text-kora-ink disabled:opacity-40"
                      >
                        <RotateCcw className="size-3" /> Restaurer cette version
                      </button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      <section className="min-w-0">
        <SectionTitle
          icon={GitCompareArrows}
          action={
            versions.length > 1 ? (
              <div className="flex flex-wrap items-center gap-2">
                <VersionSelect
                  label="De"
                  value={pair.from}
                  versions={versions}
                  onChange={(n) => setPair((p) => ({ ...p, from: n }))}
                />
                <button
                  type="button"
                  aria-label="Inverser"
                  onClick={() => setPair((p) => ({ from: p.to, to: p.from }))}
                  className="rounded-md p-1 text-kora-ink-soft hover:bg-muted hover:text-kora-ink"
                >
                  <ArrowLeftRight className="size-3.5" />
                </button>
                <VersionSelect
                  label="à"
                  value={pair.to}
                  versions={versions}
                  onChange={(n) => setPair((p) => ({ ...p, to: n }))}
                />
              </div>
            ) : null
          }
        >
          Comparaison mot à mot
        </SectionTitle>
        {versions.length < 2 ? (
          <p className="rounded-xl border border-dashed bg-white/60 px-4 py-6 text-center text-[12.5px] text-muted-foreground">
            Une seule version pour l&apos;instant : la comparaison sera disponible après le prochain
            enregistrement.
          </p>
        ) : from && to ? (
          <>
            <p className="mb-2.5 flex items-center gap-3 text-[11.5px] text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <span className="size-2.5 rounded-sm bg-kora-green" /> Ajouts
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="size-2.5 rounded-sm bg-kora-rose" /> Suppressions
              </span>
            </p>
            <VersionCompare from={from} to={to} />
          </>
        ) : null}
      </section>

      <KoraDialog
        open={restoreTarget !== null}
        onOpenChange={(o) => !o && setRestoreTarget(null)}
        title={`Restaurer la version ${restoreTarget?.n ?? ""}`}
        description="Le retour à une version précédente conserve tout l'historique."
        icon={<RotateCcw className="mt-0.5 size-5 text-kora-teal" />}
      >
        <DialogBody className="flex flex-col gap-3">
          <p className="text-[13px] text-kora-ink-soft">
            Le contenu de la version {restoreTarget?.n} deviendra la nouvelle version{" "}
            <span className="font-semibold text-kora-ink">{current + 1}</span>. Les versions{" "}
            {restoreTarget?.n}–{current} restent consultables.
          </p>
          <Banner tone={approved ? "danger" : "warning"} title="Nouvelle approbation nécessaire">
            {approved
              ? "L'approbation actuelle sera invalidée : la version restaurée devra être relue et approuvée avant toute diffusion."
              : "La version restaurée devra être relue et approuvée avant toute diffusion."}
          </Banner>
        </DialogBody>
        <DialogFooterBar>
          <GhostButton onClick={() => setRestoreTarget(null)}>Annuler</GhostButton>
          <PrimaryButton
            disabled={restore.isPending || !restoreTarget}
            onClick={() => restoreTarget && restore.mutate(restoreTarget.n)}
          >
            <RotateCcw className="size-4" /> Restaurer en version {current + 1}
          </PrimaryButton>
        </DialogFooterBar>
      </KoraDialog>
    </div>
  );
}
