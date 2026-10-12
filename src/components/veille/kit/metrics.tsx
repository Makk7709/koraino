import type { ComponentType, ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { IconTile } from "@/components/kora/primitives";
import { TONE_CLASSES, type Tone } from "@/components/kora/labels";
import { cn } from "@/lib/utils";

/** Carte KPI au style du dashboard : tuile ronde teintée, gros chiffre, libellé, aparté à droite. */
export function KpiTile({
  icon,
  tone,
  value,
  label,
  aside,
  loading = false,
  className,
}: {
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  tone: Tone;
  value: ReactNode;
  label: string;
  aside?: ReactNode;
  loading?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("kora-card flex h-[78px] items-center gap-3 px-4", className)}>
      <IconTile icon={icon} tone={tone} size="lg" />
      <div className="min-w-0 flex-1">
        {loading ? (
          <Skeleton className="h-6 w-14" />
        ) : (
          <p className="text-[22px] leading-none font-bold text-kora-ink tabular-nums">{value}</p>
        )}
        <p className="mt-1.5 truncate text-[12px] text-kora-ink-soft">{label}</p>
      </div>
      {aside && !loading && <div className="flex shrink-0 flex-col items-end gap-1.5">{aside}</div>}
    </div>
  );
}

/** Mini-histogramme des cartes KPI (barres dégradées clair → foncé). */
export function MiniBars({ values, tone }: { values: number[]; tone: Tone }) {
  const max = Math.max(1, ...values);
  const n = values.length;
  return (
    <div className="flex h-6 items-end gap-[3px]" aria-hidden>
      {values.map((v, i) => (
        <span
          key={i}
          className={cn("w-[4px] rounded-[2px]", TONE_CLASSES[tone].solid)}
          style={{
            height: `${Math.max(14, (v / max) * 100)}%`,
            opacity: n > 1 ? 0.35 + (0.65 * i) / (n - 1) : 1,
          }}
        />
      ))}
    </div>
  );
}

export function ProgressBar({
  ratio,
  tone,
  className,
}: {
  ratio: number;
  tone: Tone;
  className?: string;
}) {
  const pct = Math.max(0, Math.min(1, ratio)) * 100;
  return (
    <div
      className={cn("h-2 w-full overflow-hidden rounded-full bg-secondary", className)}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
    >
      <div
        className={cn(
          "h-full rounded-full transition-[width] duration-500",
          TONE_CLASSES[tone].solid,
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/** Petit libellé coloré au-dessus d'un mini-graphique (maquette : « ↑ +12% »). */
export function AsideLabel({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className={cn("text-[11px] font-semibold tabular-nums", TONE_CLASSES[tone].fg)}>
      {children}
    </span>
  );
}
