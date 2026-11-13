import { TrendingUp } from "lucide-react";
import { useMemo } from "react";
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
import { KoraCard, Pill } from "@/components/kora/primitives";
import { SOURCE_ACCESS, SOURCE_TYPE } from "@/components/kora/labels";
import type { CollectionRun, Source, SourceAccess, SourceType } from "@/lib/api/types";
import { cn } from "@/lib/utils";
import { BlockSkeleton, DataTable, EmptyRow, ErrorPanel, Td, Th, Tr, formatNumber } from "./kit";
import { isFailedRun, runsByDay, topNotices, type RunDay } from "./runs";

const DAYS = 14;
const ACCESS_BAR: Record<SourceAccess, string> = {
  ok: "bg-kora-green",
  erreur: "bg-kora-rose",
  en_attente: "bg-kora-amber",
  desactivee: "bg-muted-foreground/40",
};

function LegendDot({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] text-white/80">
      <span className="size-2.5 rounded-[3px]" style={{ background: color }} />
      {label}
      <span className="font-bold text-white tabular-nums">{formatNumber(value)}</span>
    </span>
  );
}

function ChartTooltip({ active, payload }: TooltipProps<number, string>) {
  const day = payload?.[0]?.payload as RunDay | undefined;
  if (!active || !day) return null;
  return (
    <div className="rounded-lg border border-kora-teal-light/60 bg-kora-night/95 px-3 py-2 text-[11px] text-white shadow-lg">
      <p className="mb-1 font-semibold">{day.label}</p>
      <p className="text-kora-aurora">{day.success} avec nouveautés</p>
      <p className="text-kora-signals">{day.empty} sans actualité</p>
      <p className="text-[oklch(0.78_0.13_10)]">{day.failed} en échec / bloquées</p>
      <p className="mt-1 text-kora-line">{day.observations} nouvelles observations</p>
    </div>
  );
}

function CollectionsChart({ days }: { days: RunDay[] }) {
  const totals = days.reduce(
    (acc, d) => ({
      success: acc.success + d.success,
      empty: acc.empty + d.empty,
      failed: acc.failed + d.failed,
    }),
    { success: 0, empty: 0, failed: 0 },
  );
  const all = totals.success + totals.empty + totals.failed;
  const rate = all ? Math.round(((totals.success + totals.empty) / all) * 100) : null;

  return (
    <section className="kora-night-panel flex flex-col p-4">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-bold text-white">Collectes par jour</h2>
          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
            <LegendDot color="var(--kora-aurora)" label="Avec nouveautés" value={totals.success} />
            <LegendDot color="var(--kora-signals)" label="Sans actualité" value={totals.empty} />
            <LegendDot color="var(--kora-rose)" label="Échecs" value={totals.failed} />
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className="rounded-lg border border-white/15 bg-white/5 px-2.5 py-1 text-[11px] text-white/80">
            {DAYS} derniers jours
          </span>
          {rate !== null && (
            <span className="inline-flex items-center gap-1 rounded-full border border-kora-aurora/40 bg-kora-aurora/10 px-2.5 py-1 text-[12px] font-bold text-kora-aurora shadow-[0_0_14px_oklch(0.818_0.174_160.5/30%)]">
              <TrendingUp className="size-3.5" /> {rate}% réussies
            </span>
          )}
        </div>
      </header>
      <div className="mt-3 h-[250px] [&_.veille-glow_path]:drop-shadow-[0_0_5px_oklch(0.818_0.174_160.5/65%)]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={days} margin={{ top: 8, right: 4, bottom: 0, left: -18 }}>
            <defs>
              <linearGradient id="veille-success" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--kora-aurora)" stopOpacity={1} />
                <stop offset="100%" stopColor="var(--kora-aurora)" stopOpacity={0.45} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.08)" />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tick={{ fill: "rgba(226,240,245,0.7)", fontSize: 11 }}
              interval={1}
            />
            <YAxis
              yAxisId="runs"
              allowDecimals={false}
              tickLine={false}
              axisLine={false}
              tick={{ fill: "rgba(226,240,245,0.6)", fontSize: 11 }}
            />
            <YAxis yAxisId="obs" orientation="right" hide />
            <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(255,255,255,0.05)" }} />
            <Bar
              yAxisId="runs"
              dataKey="success"
              stackId="runs"
              fill="url(#veille-success)"
              className="veille-glow"
              maxBarSize={18}
            />
            <Bar
              yAxisId="runs"
              dataKey="empty"
              stackId="runs"
              fill="var(--kora-signals)"
              fillOpacity={0.75}
              maxBarSize={18}
            />
            <Bar
              yAxisId="runs"
              dataKey="failed"
              stackId="runs"
              fill="var(--kora-rose)"
              radius={[3, 3, 0, 0]}
              maxBarSize={18}
            />
            <Line
              yAxisId="obs"
              type="monotone"
              dataKey="observations"
              stroke="var(--kora-line)"
              strokeWidth={2}
              dot={{ r: 2.5, fill: "var(--kora-line)", strokeWidth: 0 }}
              activeDot={{ r: 4, fill: "#fff", stroke: "var(--kora-line)", strokeWidth: 2 }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-2 text-[11px] text-white/60">
        Courbe : nouvelles observations collectées. Un échec d&apos;accès est compté à part et
        n&apos;est jamais assimilé à une collecte « sans actualité ».
      </p>
    </section>
  );
}

function CoverageStats({ runs, sources }: { runs: CollectionRun[]; sources: Source[] }) {
  const stats = useMemo(() => {
    const from = Date.now() - DAYS * 86_400_000;
    const recent = runs.filter((r) => new Date(r.startedAt).getTime() >= from);
    const reached = new Set(recent.filter((r) => !isFailedRun(r.status)).map((r) => r.sourceId));
    const active = sources.filter((s) => s.access !== "desactivee");
    const covered = active.filter((s) => reached.has(s.id)).length;
    return { active: active.length, covered, ...topNotices(recent) };
  }, [runs, sources]);
  const ratio = stats.active ? stats.covered / stats.active : 0;

  return (
    <KoraCard title="Couverture du registre">
      <div className="space-y-4">
        <div>
          <p className="text-[12px] text-kora-ink-soft">
            Sources actives jointes avec succès ({DAYS} j)
          </p>
          <p className="mt-1 text-[26px] leading-none font-bold text-kora-ink tabular-nums">
            {formatNumber(stats.covered)}
            <span className="ml-1 text-[14px] font-semibold text-muted-foreground">
              / {formatNumber(stats.active)}
            </span>
          </p>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full rounded-full bg-gradient-to-r from-kora-teal-light to-kora-teal"
              style={{ width: `${Math.round(ratio * 100)}%` }}
            />
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {Math.round(ratio * 100)}% du registre actif a répondu au moins une fois.
          </p>
        </div>
        <div>
          <p className="mb-2 text-[12px] font-semibold text-kora-ink">
            Codes d&apos;erreur fréquents
          </p>
          {stats.errors.length === 0 ? (
            <p className="text-[12px] text-muted-foreground">Aucune erreur sur la période.</p>
          ) : (
            <ul className="space-y-1.5">
              {stats.errors.map((e) => (
                <li key={e.code} className="flex items-center justify-between gap-2">
                  <Pill tone="rose" size="sm" className="font-mono">
                    {e.label}
                  </Pill>
                  <span className="text-[12px] font-semibold text-kora-ink-soft tabular-nums">
                    {e.count} occurrence{e.count > 1 ? "s" : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        {stats.warnings.length > 0 && (
          <div>
            <p className="mb-2 text-[12px] font-semibold text-kora-ink">Avertissements fréquents</p>
            <ul className="space-y-1.5">
              {stats.warnings.map((w) => (
                <li key={w.label} className="flex items-center justify-between gap-2">
                  <Pill tone="orange" size="sm" className="font-semibold">
                    {w.label}
                  </Pill>
                  <span className="text-[12px] font-semibold text-kora-ink-soft tabular-nums">
                    {w.count} collecte{w.count > 1 ? "s" : ""}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Ces collectes ont réussi ; le détail figure dans l&apos;historique.
            </p>
          </div>
        )}
      </div>
    </KoraCard>
  );
}

function CoverageByType({ sources }: { sources: Source[] }) {
  const rows = useMemo(() => {
    const byType = new Map<SourceType, Record<SourceAccess, number>>();
    for (const s of sources) {
      const r = byType.get(s.type) ?? { ok: 0, erreur: 0, en_attente: 0, desactivee: 0 };
      r[s.access]++;
      byType.set(s.type, r);
    }
    return [...byType.entries()].map(([type, counts]) => ({
      type,
      counts,
      total: counts.ok + counts.erreur + counts.en_attente + counts.desactivee,
    }));
  }, [sources]);
  const accessKeys = Object.keys(SOURCE_ACCESS) as SourceAccess[];

  return (
    <KoraCard title="Couverture par type de source">
      <DataTable>
        <thead>
          <tr>
            <Th>Type</Th>
            <Th className="text-right">Sources</Th>
            {accessKeys.map((k) => (
              <Th key={k} className="text-right">
                {SOURCE_ACCESS[k].label}
              </Th>
            ))}
            <Th className="w-[28%]">Répartition</Th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && <EmptyRow colSpan={7}>Aucune source configurée.</EmptyRow>}
          {rows.map((r) => (
            <Tr key={r.type}>
              <Td className="font-semibold">{SOURCE_TYPE[r.type]}</Td>
              <Td className="text-right font-bold tabular-nums">{r.total}</Td>
              {accessKeys.map((k) => (
                <Td
                  key={k}
                  className={cn(
                    "text-right tabular-nums",
                    k === "erreur" && r.counts[k] > 0
                      ? "font-semibold text-kora-rose"
                      : "text-kora-ink-soft",
                  )}
                >
                  {r.counts[k]}
                </Td>
              ))}
              <Td>
                <div className="flex h-2 overflow-hidden rounded-full bg-secondary">
                  {accessKeys.map((k) =>
                    r.counts[k] > 0 ? (
                      <span
                        key={k}
                        className={ACCESS_BAR[k]}
                        style={{ width: `${(r.counts[k] / r.total) * 100}%` }}
                        title={`${SOURCE_ACCESS[k].label} : ${r.counts[k]}`}
                      />
                    ) : null,
                  )}
                </div>
              </Td>
            </Tr>
          ))}
        </tbody>
      </DataTable>
    </KoraCard>
  );
}

export function CoveragePanel({
  runs,
  sources,
  error,
  onRetry,
}: {
  runs: CollectionRun[] | undefined;
  sources: Source[] | undefined;
  error: unknown;
  onRetry: () => void;
}) {
  const days = useMemo(() => runsByDay(runs ?? [], DAYS), [runs]);
  if (error) {
    return (
      <ErrorPanel title="La couverture n'a pas pu être calculée" error={error} onRetry={onRetry} />
    );
  }
  if (!runs || !sources) {
    return (
      <div className="grid grid-cols-[minmax(0,1.85fr)_minmax(0,1fr)] gap-4">
        <BlockSkeleton className="h-[340px] bg-kora-night/15" />
        <BlockSkeleton className="h-[340px]" />
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-[minmax(0,1.85fr)_minmax(0,1fr)] gap-4">
        <CollectionsChart days={days} />
        <CoverageStats runs={runs} sources={sources} />
      </div>
      <CoverageByType sources={sources} />
    </div>
  );
}
