import { Calculator, History, Save, Undo2 } from "lucide-react";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { GhostButton, KoraCard, Pill, PrimaryButton } from "@/components/kora/primitives";
import { formatDateTime } from "@/components/kora/labels";
import {
  BlockSkeleton,
  ErrorPanel,
  Field,
  Notice,
  fieldClass,
  plural,
} from "@/components/veille/kit";
import { api } from "@/lib/api/client";
import { useKoraMutation, useScoringGrids } from "@/lib/api/hooks";
import type { Criterion, ScoringGridInput } from "@/lib/api/types";
import { CRITERIA } from "./labels";
import { GridHistory } from "./scoring/GridHistory";
import { GridRadar } from "./scoring/GridRadar";
import { WeightEditor, WeightTotal } from "./scoring/WeightEditor";
import { sumWeights, type Weights } from "./scoring/weights";

/** Grille de score versionnée (§3.3). */
export function ScoringGridTab({ readOnly }: { readOnly: boolean }) {
  const grids = useScoringGrids();
  const [draft, setDraft] = useState<{ version: number; weights: Weights } | null>(null);
  const [note, setNote] = useState("");

  const save = useKoraMutation((input: ScoringGridInput) => api.createScoringGrid(input), {
    success: (g) => `Grille v${g.version} enregistrée et activée`,
    onSuccess: () => {
      setDraft(null);
      setNote("");
    },
  });
  const rescore = useKoraMutation<void, { rescored: number }>(() => api.rescoreSignals(), {
    success: (r) =>
      `${plural(r.rescored, "signal recalculé", "signaux recalculés")} avec la grille active`,
  });

  if (grids.error) {
    return (
      <ErrorPanel
        title="La grille de score n'a pas pu être chargée"
        error={grids.error}
        onRetry={() => void grids.refetch()}
      />
    );
  }
  if (!grids.data) {
    return (
      <div className="grid grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] gap-4">
        <BlockSkeleton className="h-[460px]" />
        <BlockSkeleton className="h-[460px] bg-kora-night/15" />
      </div>
    );
  }

  const active =
    grids.data.find((g) => g.active) ?? [...grids.data].sort((a, b) => b.version - a.version)[0];
  if (!active) {
    return <Notice tone="amber" title="Aucune grille de score n'est encore définie." />;
  }

  const weights = draft && draft.version === active.version ? draft.weights : active.weights;
  const changed = CRITERIA.some((k) => weights[k] !== active.weights[k]);
  const valid = sumWeights(weights) === 100;

  const setWeight = (k: Criterion, v: number) =>
    setDraft({ version: active.version, weights: { ...weights, [k]: v } });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] gap-4">
        <KoraCard
          title="Pondération des critères"
          badge={
            <Pill tone="green" size="sm">
              v{active.version} active
            </Pill>
          }
          action={
            <span className="text-[11px] text-muted-foreground">
              Par {active.createdBy} · {formatDateTime(active.createdAt)}
            </span>
          }
        >
          <WeightEditor
            weights={weights}
            reference={active.weights}
            disabled={readOnly}
            onChange={setWeight}
          />
          <div className="mt-3 rounded-xl border border-border/70 bg-secondary/40 p-3.5">
            <WeightTotal weights={weights} />
          </div>
          <form
            className="mt-4 flex items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (valid && changed) {
                save.mutate({ weights, note: note.trim() || null });
              }
            }}
          >
            <Field label="Motif du changement" htmlFor="grid-note" className="flex-1">
              <Input
                id="grid-note"
                value={note}
                disabled={readOnly}
                onChange={(e) => setNote(e.target.value)}
                placeholder="ex. Renforcer l'adéquation territoriale après la revue du pilote"
                className={fieldClass}
              />
            </Field>
            <GhostButton disabled={!changed || save.isPending} onClick={() => setDraft(null)}>
              <Undo2 className="size-4" /> Rétablir
            </GhostButton>
            <PrimaryButton
              type="submit"
              disabled={readOnly || !valid || !changed || save.isPending}
              title={
                !valid
                  ? "La somme des poids doit être égale à 100 %"
                  : !changed
                    ? "Aucune modification"
                    : undefined
              }
            >
              <Save className="size-4" />
              {save.isPending ? "Enregistrement…" : "Enregistrer une nouvelle version"}
            </PrimaryButton>
          </form>
        </KoraCard>

        <div className="flex flex-col gap-4">
          <GridRadar
            active={active.weights}
            draft={weights}
            version={active.version}
            changed={changed}
          />
          <KoraCard title="Recalcul des scores">
            <Notice
              tone="blue"
              icon={History}
              title="Les décisions historiques ne sont pas réécrites"
            >
              Un changement de grille crée une nouvelle version. Chaque score conserve la version de
              grille sous laquelle il a été calculé, ses sous-notes et ses motifs.
            </Notice>
            <div className="mt-3 flex items-center justify-between gap-3">
              <p className="text-[12px] text-kora-ink-soft">
                Applique la grille active v{active.version} aux signaux.
              </p>
              <GhostButton
                disabled={readOnly || rescore.isPending}
                onClick={() => rescore.mutate()}
                className="shrink-0"
              >
                <Calculator className="size-4" />
                {rescore.isPending ? "Recalcul…" : "Recalculer les scores"}
              </GhostButton>
            </div>
          </KoraCard>
        </div>
      </div>

      <GridHistory grids={grids.data} />
    </div>
  );
}
