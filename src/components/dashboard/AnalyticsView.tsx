import { BarChart3, Gauge, ShieldCheck, Target } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from "recharts";
import {
  CATEGORY,
  SIGNAL_STATUS,
  THEME,
  scoreOn10,
  scoreTone,
  type Tone,
} from "@/components/kora/labels";
import { EmptyState, IconTile } from "@/components/kora/primitives";
import { useAllSignals } from "@/components/signals/hooks";
import { CATEGORIES, SIGNAL_STATUSES, THEMES } from "@/components/signals/signal-utils";
import { Skeleton } from "@/components/ui/skeleton";
import type { Signal } from "@/lib/api/types";
import { cn } from "@/lib/utils";
import { TONE_GLOW } from "./dashboard-style";
import { formatPeriod, type Period } from "./period";

interface Datum {
  label: string;
  value: number;
  color: string;
  hint?: string;
}

const BUCKETS: { label: string; min: number; max: number }[] = [
  { label: "< 6", min: 0, max: 60 },
  { label: "6 – 7", min: 60, max: 70 },
  { label: "7 – 8", min: 70, max: 80 },
  { label: "8 – 9", min: 80, max: 90 },
  { label: "≥ 9", min: 90, max: 101 },
];

/** Onglet « Analyses » : répartition par catégorie, score moyen, pertinence. */
export function AnalyticsView({ period }: { period: Period }) {
  const q = useAllSignals();
  const signals = useMemo(() => {
    const from = period.from.getTime();
    const to = period.to.getTime();
    return (q.data ?? []).filter((s) => {
      const t = new Date(s.createdAt).getTime();
      return t >= from && t <= to;
    });
  }, [q.data, period]);

  const stats = useMemo(() => computeStats(signals), [signals]);

  if (q.isError)
    return (
      <EmptyState title="Analyses indisponibles">
        Les signaux n&apos;ont pas pu être chargés.
      </EmptyState>
    );

  const loading = q.isPending;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4 @min-[900px]:grid-cols-4">
        <StatTile
          icon={BarChart3}
          tone="teal"
          label="Signaux sur la période"
          value={loading ? null : String(signals.length)}
          hint={formatPeriod(period)}
        />
        <StatTile
          icon={Gauge}
          tone="rose"
          label="Score IA moyen"
          value={loading ? null : stats.avg === null ? "—" : `${scoreOn10(stats.avg)}/10`}
          hint="Grille éditoriale pondérée"
        />
        <StatTile
          icon={Target}
          tone="amber"
          label="Signaux pertinents (≥ 8/10)"
          value={loading ? null : `${stats.pertinentShare} %`}
          hint={`${stats.pertinent} sur ${signals.length}`}
        />
        <StatTile
          icon={ShieldCheck}
          tone="green"
          label="Dossiers documentaires solides"
          value={loading ? null : `${stats.solidShare} %`}
          hint="Indicateur distinct du score"
        />
      </div>

      <div className="grid gap-4 @min-[1000px]:grid-cols-3">
        <NightPanel title="Répartition par catégorie" subtitle="Nombre de signaux détectés">
          {loading ? <ChartSkeleton /> : <HorizontalBars data={stats.byCategory} unit="signal" />}
        </NightPanel>
        <NightPanel title="Score moyen par thématique" subtitle="Score IA moyen, sur 10">
          {loading ? <ChartSkeleton /> : <VerticalBars data={stats.byTheme} max={10} decimals />}
        </NightPanel>
        <NightPanel title="Pertinence des signaux" subtitle="Distribution des scores IA (sur 10)">
          {loading ? <ChartSkeleton /> : <VerticalBars data={stats.buckets} />}
          {!loading && (
            <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 border-t border-white/10 pt-3 text-[11.5px]">
              {stats.byStatus.map((s) => (
                <li key={s.label} className="flex items-center justify-between gap-2 text-white/75">
                  <span className="flex items-center gap-1.5">
                    <span className="size-2 rounded-full" style={{ background: s.color }} />
                    {s.label}
                  </span>
                  <span className="font-semibold text-white tabular-nums">{s.value}</span>
                </li>
              ))}
            </ul>
          )}
        </NightPanel>
      </div>
    </div>
  );
}

function computeStats(signals: Signal[]) {
  const n = signals.length;
  const avg = n ? signals.reduce((a, s) => a + s.score.total, 0) / n : null;
  const pertinent = signals.filter((s) => s.score.total >= 80).length;
  const solid = signals.filter((s) => s.evidence.level === "solide").length;

  const byCategory: Datum[] = CATEGORIES.map((c) => ({
    label: CATEGORY[c].label,
    value: signals.filter((s) => s.category === c).length,
    color: TONE_GLOW[CATEGORY[c].tone],
  }))
    .filter((d) => d.value > 0)
    .sort((a, b) => b.value - a.value);

  const byTheme: Datum[] = THEMES.map((t) => {
    const list = signals.filter((s) => s.themes.includes(t));
    const mean = list.length ? list.reduce((a, s) => a + s.score.total, 0) / list.length : 0;
    return {
      label: THEME[t].label,
      value: Math.round(mean) / 10,
      color: TONE_GLOW[THEME[t].tone],
      hint: `${list.length} signal${list.length > 1 ? "s" : ""}`,
    };
  }).filter((d) => d.value > 0);

  const buckets: Datum[] = BUCKETS.map((b) => ({
    label: b.label,
    value: signals.filter((s) => s.score.total >= b.min && s.score.total < b.max).length,
    color: TONE_GLOW[scoreTone(b.min === 0 ? 50 : b.min)],
  }));

  const byStatus: Datum[] = SIGNAL_STATUSES.map((st) => ({
    label: SIGNAL_STATUS[st].label,
    value: signals.filter((s) => s.status === st).length,
    color: TONE_GLOW[SIGNAL_STATUS[st].tone],
  }));

  return {
    avg,
    pertinent,
    pertinentShare: n ? Math.round((pertinent / n) * 100) : 0,
    solidShare: n ? Math.round((solid / n) * 100) : 0,
    byCategory,
    byTheme,
    buckets,
    byStatus,
  };
}

function StatTile({
  icon,
  tone,
  label,
  value,
  hint,
}: {
  icon: typeof BarChart3;
  tone: Tone;
  label: string;
  value: string | null;
  hint: string;
}) {
  return (
    <div className="kora-card flex items-center gap-3 px-3.5 py-3">
      <IconTile icon={icon} tone={tone} size="lg" />
      <div className="min-w-0">
        {value === null ? (
          <Skeleton className="h-[22px] w-14" />
        ) : (
          <p className="text-[22px] leading-none font-bold text-kora-ink tabular-nums">{value}</p>
        )}
        <p className="mt-1 truncate text-[12px] text-kora-ink-soft">{label}</p>
        <p className="truncate text-[11px] text-muted-foreground">{hint}</p>
      </div>
    </div>
  );
}

function NightPanel({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <section className="kora-night-panel flex min-w-0 flex-col px-4 pt-3.5 pb-4">
      <h2 className="text-[15px] font-bold text-white">{title}</h2>
      <p className="text-[11.5px] text-white/60">{subtitle}</p>
      <div className="mt-3 flex-1">{children}</div>
    </section>
  );
}

function ChartSkeleton() {
  return (
    <div className="flex h-[220px] items-end gap-3 px-2">
      {[60, 85, 40, 70, 55].map((h, i) => (
        <Skeleton key={i} className="flex-1 rounded-sm bg-white/10" style={{ height: `${h}%` }} />
      ))}
    </div>
  );
}

function useMounted() {
  const [m, setM] = useState(false);
  useEffect(() => setM(true), []);
  return m;
}

const axisTick = { fill: "rgba(225,240,250,0.75)", fontSize: 10.5 };

function DarkTooltip({ active, payload }: TooltipProps<number, string>) {
  const d = payload?.[0]?.payload as Datum | undefined;
  if (!active || !d) return null;
  return (
    <div className="rounded-lg border border-kora-teal-light/60 bg-[oklch(0.22_0.05_232/94%)] px-3 py-2 text-[12px] text-white shadow-lg">
      <p className="font-semibold">{d.label}</p>
      <p className="text-kora-aurora">
        {d.value}
        {d.hint ? <span className="ml-1.5 text-white/60">· {d.hint}</span> : null}
      </p>
    </div>
  );
}

function HorizontalBars({ data, unit }: { data: Datum[]; unit: string }) {
  const mounted = useMounted();
  if (!data.length) return <EmptyChart />;
  if (!mounted) return <div style={{ height: Math.max(180, data.length * 30) }} />;
  return (
    <ResponsiveContainer width="100%" height={Math.max(180, data.length * 30)}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 28, bottom: 0, left: 0 }}>
        <XAxis type="number" hide allowDecimals={false} />
        <YAxis
          type="category"
          dataKey="label"
          width={118}
          axisLine={false}
          tickLine={false}
          tick={axisTick}
        />
        <Tooltip content={DarkTooltip} cursor={{ fill: "rgba(255,255,255,0.05)" }} />
        <Bar
          dataKey="value"
          radius={[0, 4, 4, 0]}
          barSize={14}
          isAnimationActive={false}
          name={unit}
        >
          {data.map((d) => (
            <Cell key={d.label} fill={d.color} />
          ))}
          <LabelList dataKey="value" position="right" fill="#ffffff" fontSize={11} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function VerticalBars({
  data,
  max,
  decimals,
}: {
  data: Datum[];
  max?: number;
  decimals?: boolean;
}) {
  const mounted = useMounted();
  if (!data.length || data.every((d) => d.value === 0)) return <EmptyChart />;
  if (!mounted) return <div className="h-[220px]" />;
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 18, right: 6, bottom: 0, left: -18 }}>
        <CartesianGrid vertical={false} stroke="rgba(190,230,255,0.09)" />
        <XAxis
          dataKey="label"
          axisLine={false}
          tickLine={false}
          interval={0}
          tick={{ ...axisTick, fontSize: 9.5 }}
          tickFormatter={(v: string) => (v.length > 14 ? `${v.slice(0, 13)}…` : v)}
        />
        <YAxis
          axisLine={false}
          tickLine={false}
          tick={axisTick}
          allowDecimals={!!decimals}
          {...(max !== undefined ? { domain: [0, max] } : {})}
        />
        <Tooltip content={DarkTooltip} cursor={{ fill: "rgba(255,255,255,0.05)" }} />
        <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={30} isAnimationActive={false}>
          {data.map((d) => (
            <Cell
              key={d.label}
              fill={d.color}
              className="[filter:drop-shadow(0_0_5px_rgba(120,220,200,0.35))]"
            />
          ))}
          <LabelList
            dataKey="value"
            position="top"
            fill="#ffffff"
            fontSize={10.5}
            formatter={(v: number) => (decimals ? v.toFixed(1) : String(v))}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function EmptyChart() {
  return (
    <p className={cn("flex h-[200px] items-center justify-center text-[12px] text-white/60")}>
      Aucune donnée sur la période.
    </p>
  );
}
