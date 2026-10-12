import { ArrowDown, ArrowRight, ArrowUp } from "lucide-react";
import { LinkedInIcon } from "@/components/layout/Artwork";
import { TONE_CLASSES, type Tone } from "@/components/kora/labels";
import { HrefLink } from "@/components/signals/links";
import { Skeleton } from "@/components/ui/skeleton";
import type { KpiCard } from "@/lib/api/types";
import { cn } from "@/lib/utils";
import { KPI_ORDER, KPI_STYLE, TONE_BG_VAR } from "./dashboard-style";

/** Rangée des 5 cartes KPI (tuile teintée, chiffre, tendance, mini-histogramme). */
export function KpiCards({ kpis, loading }: { kpis: KpiCard[] | undefined; loading: boolean }) {
  return (
    <div className="grid grid-cols-2 gap-4 @min-[620px]:grid-cols-3 @min-[960px]:grid-cols-5">
      {KPI_ORDER.map((key) => {
        const kpi = kpis?.find((k) => k.key === key);
        return <KpiTile key={key} kpiKey={key} kpi={kpi} loading={loading} />;
      })}
    </div>
  );
}

function KpiTile({
  kpiKey,
  kpi,
  loading,
}: {
  kpiKey: KpiCard["key"];
  kpi: KpiCard | undefined;
  loading: boolean;
}) {
  const style = KPI_STYLE[kpiKey];
  const Icon = style.icon;
  const t = TONE_CLASSES[style.tone];
  return (
    <HrefLink
      href={style.href}
      className="kora-card group flex h-[74px] min-w-0 items-center gap-2.5 px-3 transition hover:-translate-y-px hover:shadow-[0_10px_28px_-14px_oklch(0.495_0.084_212.6/40%)]"
      style={{
        backgroundImage: `radial-gradient(140px 90px at 0% 50%, color-mix(in oklch, ${TONE_BG_VAR[style.tone]} 75%, transparent), transparent 72%)`,
      }}
    >
      <span
        className={cn(
          "inline-flex size-10 shrink-0 items-center justify-center rounded-full ring-[5px] ring-white/70",
          Icon === "linkedin"
            ? "bg-kora-linkedin text-white shadow-[0_4px_12px_-4px_oklch(0.516_0.163_254.7/70%)]"
            : [t.bg, t.fg],
        )}
      >
        {Icon === "linkedin" ? (
          <LinkedInIcon className="size-[19px]" />
        ) : (
          <Icon className="size-[21px]" strokeWidth={2} />
        )}
      </span>

      <span className="min-w-0 flex-1">
        {kpi ? (
          <span className="block text-[22px] leading-none font-bold tracking-tight text-kora-ink tabular-nums">
            {kpi.value}
          </span>
        ) : (
          <Skeleton className={cn("h-[22px] w-10", !loading && "animate-none")} />
        )}
        <span className="mt-1 block truncate text-[11px] leading-tight text-kora-ink-soft">
          {kpi?.label ?? style.label}
        </span>
      </span>

      <span className="flex shrink-0 flex-col items-end gap-1.5 self-stretch py-3">
        {kpi ? <Trend kpi={kpi} /> : <span className="h-3.5" />}
        <MiniBars values={kpi?.spark} tone={style.tone} />
      </span>
    </HrefLink>
  );
}

function Trend({ kpi }: { kpi: KpiCard }) {
  const Icon =
    kpi.trendDirection === "up" ? ArrowUp : kpi.trendDirection === "down" ? ArrowDown : ArrowRight;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 text-[11px] leading-none font-bold tabular-nums",
        kpi.trendDirection === "up"
          ? "text-kora-green"
          : kpi.trendDirection === "down"
            ? "text-kora-rose"
            : "text-muted-foreground",
      )}
    >
      <Icon className="size-3" strokeWidth={3} />
      {kpi.trend}
    </span>
  );
}

/** Mini-histogramme de 7 barres, du clair au foncé (couleur de la tuile). */
function MiniBars({ values, tone }: { values: number[] | undefined; tone: Tone }) {
  const data = values && values.length > 0 ? values.slice(-7) : [3, 4, 4, 5, 6, 7, 8];
  const max = Math.max(...data, 1);
  const solid = TONE_CLASSES[tone].solid;
  return (
    <span
      aria-hidden
      className={cn("flex h-[22px] items-end gap-[2.5px]", !values && "opacity-30")}
    >
      {data.map((v, i) => (
        <span
          key={i}
          className={cn("w-[3.5px] rounded-[1.5px]", solid)}
          style={{
            height: `${Math.max(18, (v / max) * 100)}%`,
            opacity: 0.38 + (0.62 * (i + 1)) / data.length,
          }}
        />
      ))}
    </span>
  );
}
