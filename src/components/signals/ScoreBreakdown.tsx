import { CRITERION, TONE_CLASSES, scoreOn10, scoreTone } from "@/components/kora/labels";
import { KoraCard, Pill } from "@/components/kora/primitives";
import { useScoringGrids } from "@/lib/api/hooks";
import type { Criterion, ScoreResult } from "@/lib/api/types";
import { cn } from "@/lib/utils";

const CRITERIA = Object.keys(CRITERION) as Criterion[];

/** Grille de score détaillée : 5 sous-scores, poids, motifs, version de grille. */
export function ScoreBreakdown({ score, className }: { score: ScoreResult; className?: string }) {
  const grids = useScoringGrids();
  const grid = grids.data?.find((g) => g.version === score.gridVersion);
  const active = grids.data?.find((g) => g.active);

  return (
    <KoraCard
      title="Grille de score"
      badge={
        <Pill tone="teal" size="sm" className="font-semibold">
          Grille v{score.gridVersion}
        </Pill>
      }
      action={
        <span className="text-[13px] font-bold text-kora-ink tabular-nums">
          {scoreOn10(score.total)}
          <span className="text-[11px] font-semibold text-muted-foreground">/10</span>
        </span>
      }
      className={cn(className)}
    >
      {active && active.version !== score.gridVersion && (
        <p className="mb-2.5 rounded-lg bg-kora-amber-bg px-2.5 py-1.5 text-[11.5px] text-kora-ink-soft">
          Score calculé avec la grille v{score.gridVersion} (grille active : v{active.version}). Un
          changement de grille ne réécrit pas les décisions passées.
        </p>
      )}
      <ul className="space-y-2.5">
        {CRITERIA.map((c) => {
          const sub = score.subScores[c];
          const weight = grid?.weights[c];
          const t = TONE_CLASSES[scoreTone(sub)];
          return (
            <li key={c}>
              <div className="flex items-baseline justify-between gap-2 text-[12px]">
                <span className="font-semibold text-kora-ink">
                  {CRITERION[c]}
                  {weight !== undefined && (
                    <span className="ml-1.5 font-medium text-muted-foreground">× {weight} %</span>
                  )}
                </span>
                <span className={cn("font-bold tabular-nums", t.fg)}>{scoreOn10(sub)}/10</span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn("h-full rounded-full", t.solid)}
                  style={{ width: `${Math.max(2, Math.min(100, sub))}%` }}
                />
              </div>
              {score.reasons[c] && (
                <p className="mt-1 text-[11.5px] leading-snug text-muted-foreground">
                  {score.reasons[c]}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      <p className="mt-3 border-t border-border pt-2.5 text-[11px] leading-snug text-muted-foreground">
        Score éditorial = somme pondérée des sous-scores (poids totalisant 100 %). Il mesure
        l&apos;intérêt éditorial, pas la fiabilité des sources.
      </p>
    </KoraCard>
  );
}
