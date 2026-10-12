import { endOfDay, startOfDay, subDays } from "date-fns";
import { useEffect, useId, useMemo, useState } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from "recharts";
import { FilterSelect } from "@/components/signals/FilterSelect";
import { plural } from "@/components/signals/signal-utils";
import { Skeleton } from "@/components/ui/skeleton";
import { useDashboard } from "@/lib/api/hooks";
import type { ActivityPoint } from "@/lib/api/types";
import { cn } from "@/lib/utils";

type Span = "7" | "30" | "90";

const SPANS: { value: Span; label: string; vs: string }[] = [
  { value: "30", label: "30 derniers jours", vs: "vs mois précédent" },
  { value: "7", label: "7 derniers jours", vs: "vs 7 jours précédents" },
  { value: "90", label: "90 derniers jours", vs: "vs trimestre précédent" },
];

const tickFmt = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" });

interface ChartPoint {
  label: string;
  signals: number;
  articles: number;
}

/** Carte sombre « Activité éditoriale » : barres d'articles + courbe des signaux. */
export function ActivityCard({ className }: { className?: string }) {
  const [span, setSpan] = useState<Span>("30");
  const range = useMemo(() => {
    const now = new Date();
    return {
      from: startOfDay(subDays(now, Number(span) - 1)).toISOString(),
      to: endOfDay(now).toISOString(),
    };
  }, [span]);
  const q = useDashboard(range);
  const activity = q.data?.activity;
  const spanInfo = SPANS.find((s) => s.value === span) ?? SPANS[0]!;

  return (
    <section
      className={cn("kora-night-panel relative flex min-w-0 flex-col overflow-hidden", className)}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -top-16 left-[38%] h-40 w-72 rotate-[-18deg] rounded-full bg-kora-aurora/20 blur-3xl"
      />
      <header className="relative flex items-center justify-between gap-3 px-4 pt-3.5">
        <h2 className="text-[16px] font-bold tracking-tight text-white">Activité éditoriale</h2>
        <FilterSelect
          label="Période de l'activité"
          tone="dark"
          value={span}
          onValueChange={(v) => setSpan((v as Span | undefined) ?? "30")}
          options={SPANS}
          className="h-8 min-w-[9.5rem] rounded-lg"
        />
      </header>

      <div className="relative flex flex-wrap items-center gap-x-5 gap-y-1 px-4 pt-2 text-[11.5px] text-white/75">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-[2px] bg-[#5b8def]" />
          Signaux détectés
          <span className="text-[14px] font-semibold text-kora-signals tabular-nums">
            {activity?.totalSignals ?? "—"}
          </span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-[2px] bg-kora-aurora" />
          Articles publiés
          <span className="text-[14px] font-semibold text-[#b8f27a] tabular-nums">
            {activity?.totalArticles ?? "—"}
          </span>
        </span>
      </div>

      <div className="relative min-h-[132px] flex-1 px-2 pt-1 pb-2">
        {activity && (
          <div className="absolute top-0 right-4 z-10 flex items-center gap-2 rounded-full border border-white/15 bg-[oklch(0.24_0.05_230/85%)] py-1 pr-3 pl-2.5 shadow-[0_0_16px_oklch(0.8_0.15_160/18%)]">
            <span className="size-2 rounded-full bg-kora-aurora shadow-[0_0_8px_var(--kora-aurora)]" />
            <span className="leading-none">
              <span className="block text-[14px] font-bold text-white tabular-nums">
                {activity.trend}
              </span>
              <span className="block text-[9px] text-white/65">{spanInfo.vs}</span>
            </span>
          </div>
        )}
        {q.isError ? (
          <p className="flex h-full min-h-[120px] items-center justify-center text-[12px] text-white/60">
            Activité indisponible pour le moment.
          </p>
        ) : activity ? (
          <ActivityChart points={activity.points} />
        ) : (
          <div className="flex h-full min-h-[120px] items-end gap-2 px-6 pb-5">
            {Array.from({ length: 14 }).map((_, i) => (
              <Skeleton
                key={i}
                className="flex-1 rounded-sm bg-white/10"
                style={{ height: `${25 + ((i * 37) % 60)}%` }}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function useMounted() {
  const [m, setM] = useState(false);
  useEffect(() => setM(true), []);
  return m;
}

function ActivityChart({ points }: { points: ActivityPoint[] }) {
  const mounted = useMounted();
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const data: ChartPoint[] = useMemo(
    () =>
      points.map((p) => ({
        label: tickFmt.format(new Date(p.date)).replace(".", ""),
        signals: p.signals,
        articles: p.articles,
      })),
    [points],
  );
  const ticks = useMemo(() => {
    const n = data.length;
    if (n <= 5) return data.map((d) => d.label);
    const idx = [
      0,
      Math.round((n - 1) * 0.25),
      Math.round((n - 1) * 0.5),
      Math.round((n - 1) * 0.75),
      n - 1,
    ];
    return [...new Set(idx)].map((i) => data[i]?.label).filter((l): l is string => !!l);
  }, [data]);
  const dotEvery = data.length > 16 ? Math.ceil(data.length / 10) : 1;

  if (!mounted) return <div className="h-full min-h-[128px]" />;
  if (data.length === 0)
    return (
      <p className="flex h-full min-h-[120px] items-center justify-center text-[12px] text-white/60">
        Aucune activité sur la période.
      </p>
    );

  return (
    <ResponsiveContainer width="100%" height="100%" minHeight={128}>
      <ComposedChart data={data} margin={{ top: 14, right: 12, bottom: 0, left: -14 }}>
        <defs>
          <linearGradient id={`${id}-bar`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#5dffa8" stopOpacity={1} />
            <stop offset="55%" stopColor="#22c55e" stopOpacity={0.85} />
            <stop offset="100%" stopColor="#0f766e" stopOpacity={0.35} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="rgba(190,230,255,0.09)" />
        <XAxis
          dataKey="label"
          ticks={ticks}
          interval={0}
          axisLine={false}
          tickLine={false}
          tick={{ fill: "rgba(225,240,250,0.72)", fontSize: 10 }}
          tickMargin={6}
        />
        <YAxis
          axisLine={false}
          tickLine={false}
          allowDecimals={false}
          width={40}
          tick={{ fill: "rgba(225,240,250,0.72)", fontSize: 10 }}
        />
        <Tooltip
          content={renderTooltip}
          cursor={{ stroke: "rgba(94,232,200,0.55)", strokeWidth: 1 }}
          wrapperStyle={{ outline: "none" }}
        />
        <Bar
          dataKey="articles"
          fill={`url(#${id}-bar)`}
          radius={[3, 3, 0, 0]}
          maxBarSize={11}
          isAnimationActive={false}
          className="[filter:drop-shadow(0_0_5px_rgba(62,224,138,0.55))]"
        />
        <Line
          type="linear"
          dataKey="signals"
          stroke="#8fb3ff"
          strokeWidth={1.8}
          isAnimationActive={false}
          className="[filter:drop-shadow(0_0_4px_rgba(120,160,255,0.9))]"
          dot={(props: { cx?: number; cy?: number; index?: number }) => {
            const { cx, cy, index = 0 } = props;
            if (cx === undefined || cy === undefined || index % dotEvery !== 0)
              return <g key={`d-${index}`} />;
            return (
              <circle
                key={`d-${index}`}
                cx={cx}
                cy={cy}
                r={3}
                fill="#e6eeff"
                stroke="#7aa2ff"
                strokeWidth={1.5}
              />
            );
          }}
          activeDot={{ r: 6, fill: "#5ee8ff", stroke: "#d6fbff", strokeWidth: 2 }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

function renderTooltip({ active, payload }: TooltipProps<number, string>) {
  const p = payload?.[0]?.payload as ChartPoint | undefined;
  if (!active || !p) return null;
  return (
    <div className="rounded-lg border border-kora-teal-light/70 bg-[oklch(0.22_0.05_232/94%)] px-3 py-2 text-[12px] leading-tight shadow-[0_0_18px_oklch(0.8_0.12_195/35%)]">
      <p className="text-white">{plural(p.signals, "signal", "signaux")}</p>
      <p className="mt-0.5 font-semibold text-kora-aurora">
        {plural(p.articles, "article", "articles")}
      </p>
    </div>
  );
}
