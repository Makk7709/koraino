import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CRITERION, scoreOn10 } from "@/components/kora/labels";
import { useScoringGrids } from "@/lib/api/hooks";
import type { Criterion, ScoreResult } from "@/lib/api/types";
import { cn } from "@/lib/utils";

const CRITERIA = Object.keys(CRITERION) as Criterion[];

/** Pastille ⓘ pleine (maquette, en-tête « Score IA »). */
export function InfoDot({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-[13px] items-center justify-center rounded-full bg-kora-ink-soft text-[9px] leading-none font-bold text-white",
        className,
      )}
    >
      i
    </span>
  );
}

/**
 * Info-bulle « Score IA » : grille pondérée versionnée (sous-scores et poids) ;
 * rappelle que l'indicateur documentaire est un état distinct, pas une probabilité.
 */
export function ScoreInfoTooltip({
  score,
  className,
  side = "top",
}: {
  score?: ScoreResult | undefined;
  className?: string;
  side?: "top" | "bottom" | "left" | "right";
}) {
  const grids = useScoringGrids();
  const grid = score
    ? grids.data?.find((g) => g.version === score.gridVersion)
    : grids.data?.find((g) => g.active);
  const version = score?.gridVersion ?? grid?.version;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label="Comprendre le score IA"
          onClick={(e) => e.stopPropagation()}
          className={cn(
            "inline-flex items-center rounded-full focus-visible:ring-2 focus-visible:ring-kora-teal-light focus-visible:outline-none",
            className,
          )}
        >
          <InfoDot />
        </button>
      </TooltipTrigger>
      <TooltipContent
        side={side}
        className="max-w-[300px] rounded-xl border border-kora-teal/30 bg-kora-ink px-3.5 py-3 text-[12px] leading-snug text-white shadow-lg"
      >
        <p className="font-semibold">
          Score IA{version !== undefined ? ` · grille v${version}` : ""}
        </p>
        <p className="mt-1 text-white/75">
          Score éditorial 0–100 affiché sur 10 : somme pondérée de cinq critères.
        </p>
        <ul className="mt-2 space-y-1">
          {CRITERIA.map((c) => (
            <li key={c} className="flex items-center justify-between gap-3">
              <span className="text-white/85">{CRITERION[c]}</span>
              <span className="tabular-nums text-white">
                {score ? `${scoreOn10(score.subScores[c])}/10` : ""}
                {grid ? (
                  <span className="ml-1.5 text-kora-teal-light">× {grid.weights[c]} %</span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
        {score && (
          <p className="mt-2 border-t border-white/10 pt-2 font-semibold">
            Total : {scoreOn10(score.total)}/10
          </p>
        )}
        <p className="mt-2 text-[11px] text-white/65">
          Une nouvelle grille ne réécrit pas les décisions passées. L&apos;indicateur documentaire
          (sources, corroborations, fraîcheur) est distinct du score et n&apos;est pas une
          probabilité.
        </p>
      </TooltipContent>
    </Tooltip>
  );
}
