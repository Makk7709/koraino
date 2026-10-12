import { Ban, Info, Wallet } from "lucide-react";
import { IconTile, Pill } from "@/components/kora/primitives";
import { TONE_CLASSES } from "@/components/kora/labels";
import {
  BlockSkeleton,
  ErrorPanel,
  Notice,
  ProgressBar,
  formatNumber,
  ratioTone,
} from "@/components/veille/kit";
import { useUsage } from "@/lib/api/hooks";
import type { QuotaMeter } from "@/lib/api/types";
import { cn } from "@/lib/utils";
import { METER_DIGITS, METER_ICON } from "./labels";

const ALERT_LABEL: Record<QuotaMeter["alert"], string> = {
  ok: "Sous le seuil",
  seuil_80: "Alerte 80 %",
  atteint: "Plafond atteint",
};

const GAUGE = {
  green: { stroke: "var(--kora-aurora)", glow: "oklch(0.818 0.174 160.5 / 45%)" },
  amber: { stroke: "var(--kora-amber)", glow: "oklch(0.737 0.153 75.9 / 45%)" },
  rose: { stroke: "var(--kora-rose)", glow: "oklch(0.628 0.198 10 / 50%)" },
} as const;

function meterTone(m: QuotaMeter) {
  if (m.alert === "atteint") return "rose" as const;
  if (m.alert === "seuil_80") return ratioTone(Math.max(m.ratio, 0.8));
  return ratioTone(m.ratio);
}

function fmt(m: QuotaMeter, value: number) {
  return formatNumber(value, METER_DIGITS[m.key] ?? 0);
}

function formatMonth(month: string): string {
  const match = /^(\d{4})-(\d{2})/.exec(month);
  if (!match) return month;
  const d = new Date(Number(match[1]), Number(match[2]) - 1, 1);
  return new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" }).format(d);
}

function BudgetPanel({
  meter,
  month,
  suspended,
}: {
  meter: QuotaMeter;
  month: string;
  suspended: boolean;
}) {
  const tone = meterTone(meter);
  const gauge = GAUGE[tone === "rose" ? "rose" : tone === "amber" ? "amber" : "green"];
  const pct = Math.min(1, Math.max(0, meter.ratio));
  const r = 54;
  const c = 2 * Math.PI * r;
  return (
    <section className="kora-night-panel flex flex-col p-5">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-bold text-white">Budget API</h2>
          <p className="mt-0.5 text-[12px] text-white/70">Consommation de {formatMonth(month)}</p>
        </div>
        <span className="rounded-lg border border-white/15 bg-white/5 px-2.5 py-1 text-[11px] text-white/80">
          Non reportable
        </span>
      </header>
      <div className="mt-4 flex items-center gap-6">
        <div className="relative size-[140px] shrink-0">
          <svg viewBox="0 0 140 140" className="size-full -rotate-90">
            <circle
              cx="70"
              cy="70"
              r={r}
              fill="none"
              stroke="rgba(255,255,255,0.1)"
              strokeWidth="12"
            />
            <circle
              cx="70"
              cy="70"
              r={r}
              fill="none"
              stroke={gauge.stroke}
              strokeWidth="12"
              strokeLinecap="round"
              strokeDasharray={`${c * pct} ${c}`}
              style={{ filter: `drop-shadow(0 0 6px ${gauge.glow})` }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-[26px] leading-none font-bold text-white tabular-nums">
              {Math.round(meter.ratio * 100)}%
            </span>
            <span className="mt-1 text-[11px] text-white/70">consommé</span>
          </div>
        </div>
        <div className="min-w-0 space-y-2">
          <p className="text-[30px] leading-none font-bold text-white tabular-nums">
            {fmt(meter, meter.used)} €
          </p>
          <p className="text-[13px] text-white/75">sur {fmt(meter, meter.limit)} € HT ce mois</p>
          <p className="text-[12px] text-white/70">
            Reste{" "}
            <span className="font-semibold text-kora-line">
              {fmt(meter, Math.max(0, meter.limit - meter.used))} €
            </span>
          </p>
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold",
              suspended
                ? "border-kora-rose/50 bg-kora-rose/15 text-[oklch(0.82_0.11_10)]"
                : "border-kora-aurora/40 bg-kora-aurora/10 text-kora-aurora",
            )}
          >
            <span
              className={cn("size-1.5 rounded-full", suspended ? "bg-kora-rose" : "bg-kora-aurora")}
            />
            {suspended ? "Appels payants suspendus" : "Appels payants actifs"}
          </span>
        </div>
      </div>
      <p className="mt-5 border-t border-white/10 pt-3 text-[11px] leading-relaxed text-white/65">
        Atteint avant un quota, ce plafond prévaut. Le moteur réserve un coût maximal estimé avant
        chaque appel. Alertes à 80 % puis 100 % ; à 100 %, les appels payants sont suspendus,
        consultation et exports restent accessibles.
      </p>
    </section>
  );
}

function MeterCard({ meter }: { meter: QuotaMeter }) {
  const tone = meterTone(meter);
  const Icon = METER_ICON[meter.key];
  return (
    <div className="kora-card p-3.5">
      <div className="flex items-center gap-2.5">
        <IconTile icon={Icon} tone={tone === "green" ? "teal" : tone} size="md" />
        <p className="min-w-0 flex-1 truncate text-[13px] font-semibold text-kora-ink">
          {meter.label}
        </p>
        <Pill tone={tone} size="sm">
          {ALERT_LABEL[meter.alert]}
        </Pill>
      </div>
      <p className="mt-3 text-[20px] leading-none font-bold text-kora-ink tabular-nums">
        {fmt(meter, meter.used)}
        <span className="ml-1 text-[13px] font-semibold text-muted-foreground">
          / {fmt(meter, meter.limit)} {meter.unit}
        </span>
      </p>
      <ProgressBar ratio={meter.ratio} tone={tone} className="mt-2.5" />
      <div className="mt-1.5 flex justify-between text-[11px] text-muted-foreground tabular-nums">
        <span className={cn(tone !== "green" && cn("font-semibold", TONE_CLASSES[tone].fg))}>
          {Math.round(meter.ratio * 100)} %
        </span>
        <span>reste {fmt(meter, Math.max(0, meter.limit - meter.used))}</span>
      </div>
    </div>
  );
}

/** Quotas & budget (§12). */
export function QuotasTab() {
  const usage = useUsage();
  if (usage.error) {
    return (
      <ErrorPanel
        title="Les quotas n'ont pas pu être chargés"
        error={usage.error}
        onRetry={() => void usage.refetch()}
      />
    );
  }
  if (!usage.data) {
    return (
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.7fr)] gap-4">
        <BlockSkeleton className="h-[380px] bg-kora-night/15" />
        <div className="grid grid-cols-2 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <BlockSkeleton key={i} className="h-[112px]" />
          ))}
        </div>
      </div>
    );
  }

  const { meters, paidCallsSuspended, month } = usage.data;
  const budget = meters.find((m) => m.key === "api_budget_eur");
  const others = meters.filter((m) => m.key !== "api_budget_eur");
  const alerts = others.filter((m) => m.alert !== "ok");

  return (
    <div className="space-y-4">
      {paidCallsSuspended && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-xl border border-kora-rose/30 bg-kora-rose-bg/70 px-4 py-3"
        >
          <IconTile icon={Ban} tone="rose" size="md" className="bg-white" />
          <div>
            <p className="text-[14px] font-bold text-kora-ink">Budget API atteint</p>
            <p className="text-[12px] text-kora-ink-soft">
              Les appels payants sont suspendus ; consultation et exports restent accessibles. Un
              dépassement peut être commandé au coût fournisseur justifié, dans une limite écrite.
            </p>
          </div>
        </div>
      )}
      {alerts.length > 0 && !paidCallsSuspended && (
        <Notice
          tone="amber"
          title={`${alerts.length} compteur${alerts.length > 1 ? "s" : ""} au-delà du seuil d'alerte`}
        >
          {alerts.map((m) => `${m.label} (${Math.round(m.ratio * 100)} %)`).join(" · ")}
        </Notice>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.7fr)] items-start gap-4">
        {budget ? (
          <BudgetPanel meter={budget} month={month} suspended={paidCallsSuspended} />
        ) : (
          <section className="kora-night-panel flex items-center gap-3 p-5 text-white/80">
            <Wallet className="size-5" /> Budget API non communiqué.
          </section>
        )}
        <div className="grid grid-cols-2 gap-4 2xl:grid-cols-3">
          {others.map((m) => (
            <MeterCard key={m.key} meter={m} />
          ))}
        </div>
      </div>

      <Notice tone="gray" icon={Info}>
        Quotas mensuels de l&apos;abonnement : 1 espace, 5 comptes, 150 entreprises, 300 URL/flux, 3
        000 recherches web, 6 000 observations, 25 articles, 25 posts LinkedIn, 5 newsletters, 10
        Go. Les plafonds sont cumulatifs : le service ne promet pas d&apos;atteindre tous les maxima
        avec 150 € d&apos;API.
      </Notice>
    </div>
  );
}
