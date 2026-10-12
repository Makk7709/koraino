import { CircleAlert, CircleCheck } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { IconTile } from "@/components/kora/primitives";
import { CRITERION, TONE_CLASSES } from "@/components/kora/labels";
import type { Criterion } from "@/lib/api/types";
import { cn } from "@/lib/utils";
import { CRITERIA, CRITERION_META } from "../labels";
import { sumWeights, type Weights } from "./weights";

function clamp(n: number) {
  return Math.max(0, Math.min(100, Math.round(Number.isFinite(n) ? n : 0)));
}

function WeightRow({
  criterion,
  value,
  reference,
  disabled,
  onChange,
}: {
  criterion: Criterion;
  value: number;
  reference: number;
  disabled: boolean;
  onChange: (v: number) => void;
}) {
  const meta = CRITERION_META[criterion];
  const delta = value - reference;
  return (
    <div className="grid grid-cols-[minmax(0,1.15fr)_minmax(0,1.4fr)_5.5rem] items-center gap-5 border-b border-border/70 py-3 last:border-b-0">
      <div className="flex min-w-0 items-center gap-3">
        <IconTile icon={meta.icon} tone={meta.tone} size="md" />
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-kora-ink">{CRITERION[criterion]}</p>
          <p className="truncate text-[11px] text-muted-foreground" title={meta.hint}>
            {meta.hint}
          </p>
        </div>
      </div>
      <Slider
        value={[value]}
        min={0}
        max={60}
        step={1}
        disabled={disabled}
        aria-label={`Poids ${CRITERION[criterion]}`}
        onValueChange={(v) => onChange(clamp(v[0] ?? 0))}
        className="py-1"
      />
      <div className="flex items-center justify-end gap-1.5">
        {delta !== 0 && (
          <span
            className={cn(
              "text-[11px] font-semibold tabular-nums",
              delta > 0 ? "text-kora-green" : "text-kora-orange",
            )}
          >
            {delta > 0 ? `+${delta}` : delta}
          </span>
        )}
        <label className="flex h-8 items-center rounded-lg border border-border bg-white pr-2 focus-within:ring-1 focus-within:ring-kora-teal/40">
          <input
            type="number"
            min={0}
            max={100}
            value={value}
            disabled={disabled}
            aria-label={`Poids ${CRITERION[criterion]} en pourcentage`}
            onChange={(e) => onChange(clamp(e.target.valueAsNumber))}
            className="w-9 bg-transparent text-right text-[13px] font-bold text-kora-ink tabular-nums outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
          />
          <span className="text-[12px] text-muted-foreground">%</span>
        </label>
      </div>
    </div>
  );
}

export function WeightEditor({
  weights,
  reference,
  disabled,
  onChange,
}: {
  weights: Weights;
  reference: Weights;
  disabled: boolean;
  onChange: (criterion: Criterion, value: number) => void;
}) {
  return (
    <div>
      {CRITERIA.map((k) => (
        <WeightRow
          key={k}
          criterion={k}
          value={weights[k]}
          reference={reference[k]}
          disabled={disabled}
          onChange={(v) => onChange(k, v)}
        />
      ))}
    </div>
  );
}

/** Répartition des poids + indicateur de total (vert à 100 %, rose sinon). */
export function WeightTotal({ weights }: { weights: Weights }) {
  const total = sumWeights(weights);
  const ok = total === 100;
  const gap = 100 - total;
  return (
    <div className="flex items-center gap-5">
      <div className="min-w-0 flex-1">
        <div className="flex h-3 overflow-hidden rounded-full bg-secondary">
          {CRITERIA.map((k) =>
            weights[k] > 0 ? (
              <span
                key={k}
                className={cn(
                  "h-full transition-[width]",
                  TONE_CLASSES[CRITERION_META[k].tone].solid,
                )}
                style={{ width: `${(weights[k] / Math.max(total, 100)) * 100}%` }}
                title={`${CRITERION[k]} : ${weights[k]} %`}
              />
            ) : null,
          )}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
          {CRITERIA.map((k) => (
            <span key={k} className="inline-flex items-center gap-1 text-[11px] text-kora-ink-soft">
              <span
                className={cn("size-2 rounded-sm", TONE_CLASSES[CRITERION_META[k].tone].solid)}
              />
              {CRITERION_META[k].short} {weights[k]} %
            </span>
          ))}
        </div>
      </div>
      <div
        role="status"
        className={cn(
          "flex min-w-[8.5rem] flex-col items-center rounded-xl border px-4 py-2",
          ok
            ? "border-kora-green/25 bg-kora-green-bg text-kora-green"
            : "border-kora-rose/25 bg-kora-rose-bg text-kora-rose",
        )}
      >
        <span className="flex items-center gap-1.5 text-[22px] leading-none font-bold tabular-nums">
          {ok ? <CircleCheck className="size-4" /> : <CircleAlert className="size-4" />}
          {total} %
        </span>
        <span className="mt-1 text-[11px] font-medium">
          {ok
            ? "Total conforme"
            : gap > 0
              ? `Il manque ${gap} point${gap > 1 ? "s" : ""}`
              : `${-gap} point${-gap > 1 ? "s" : ""} en trop`}
        </span>
      </div>
    </div>
  );
}
