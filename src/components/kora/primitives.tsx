import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { SignalStatus } from "@/lib/api/types";
import { SIGNAL_STATUS, TONE_CLASSES, scoreOn10, scoreTone, type Tone } from "./labels";

/** Pastille arrondie teintée (statuts, tags). */
export function Pill({
  tone = "gray",
  children,
  className,
  size = "md",
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
  size?: "sm" | "md";
}) {
  const t = TONE_CLASSES[tone];
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center gap-1 whitespace-nowrap rounded-md font-medium",
        size === "sm" ? "px-1.5 py-0.5 text-[10px]" : "px-2.5 py-1 text-xs",
        t.bg,
        t.fg,
        className,
      )}
    >
      {children}
    </span>
  );
}

export function StatusPill({ status, className }: { status: SignalStatus; className?: string }) {
  const s = SIGNAL_STATUS[status];
  return (
    <Pill tone={s.tone} className={cn("min-w-[5.5rem]", className)}>
      {s.label}
    </Pill>
  );
}

/** Pastille « Score IA » : score 0–100 affiché sur 10. */
export function ScorePill({ total, className }: { total: number; className?: string }) {
  const t = TONE_CLASSES[scoreTone(total)];
  return (
    <span
      className={cn(
        "inline-flex min-w-[3.25rem] items-center justify-center rounded-lg px-2.5 py-1.5 text-base font-bold tabular-nums",
        t.bg,
        t.fg,
        className,
      )}
    >
      {scoreOn10(total)}
    </span>
  );
}

/** Confiance de rattachement entreprise (maquette : « Confiance 92% »). */
export function ConfidenceBadge({ value, className }: { value: number; className?: string }) {
  const tone: Tone = value >= 75 ? "green" : value >= 50 ? "amber" : "rose";
  return (
    <Pill tone={tone} size="sm" className={cn("font-semibold", className)}>
      Confiance {Math.round(value)}%
    </Pill>
  );
}

/** Petit compteur pastel à droite des lignes de catégories. */
export function CountBadge({
  value,
  tone = "blue",
  className,
}: {
  value: number;
  tone?: Tone;
  className?: string;
}) {
  const t = TONE_CLASSES[tone];
  return (
    <span
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-md px-1.5 text-[11px] font-semibold tabular-nums",
        t.bg,
        t.fg,
        className,
      )}
    >
      {value}
    </span>
  );
}

/** Compteur plein (titres de cartes : 8 rouge, 12 orange, 28 vert). */
export function SolidBadge({
  value,
  tone,
  className,
}: {
  value: number | string;
  tone: Tone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-5 min-w-6 items-center justify-center rounded-full px-2 text-[11px] font-bold text-white tabular-nums",
        TONE_CLASSES[tone].solid,
        className,
      )}
    >
      {value}
    </span>
  );
}

/** Tuile d'icône teintée (KPI, catégories). */
export function IconTile({
  icon: Icon,
  tone,
  size = "md",
  className,
}: {
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  tone: Tone;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const t = TONE_CLASSES[tone];
  const box =
    size === "lg"
      ? "size-11 rounded-full"
      : size === "md"
        ? "size-8 rounded-lg"
        : "size-6 rounded-md";
  const ico = size === "lg" ? "size-5" : size === "md" ? "size-4" : "size-3.5";
  return (
    <span
      className={cn("inline-flex shrink-0 items-center justify-center", box, t.bg, t.fg, className)}
    >
      <Icon className={ico} strokeWidth={2} />
    </span>
  );
}

export function SeeAll({ to, label = "Voir tout" }: { to: string; label?: string }) {
  return (
    <Link
      to={to}
      className="inline-flex items-center gap-1 text-[11px] font-medium text-kora-ink-soft transition-colors hover:text-kora-teal"
    >
      {label} <ArrowRight className="size-3" />
    </Link>
  );
}

/** Carte blanche standard de la maquette. */
export function KoraCard({
  title,
  badge,
  action,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  badge?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn("kora-card flex flex-col", className)}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-3 px-4 pt-3.5 pb-2">
          <div className="flex min-w-0 items-center gap-2">
            {typeof title === "string" ? (
              <h2 className="truncate text-[15px] font-bold text-kora-ink">{title}</h2>
            ) : (
              title
            )}
            {badge}
          </div>
          {action}
        </header>
      )}
      <div className={cn("flex-1 px-4 pb-4", !title && !action && "pt-4", bodyClassName)}>
        {children}
      </div>
    </section>
  );
}

/** Titre de section de page secondaire. */
export function PageTitle({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-kora-ink">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-kora-ink-soft">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed bg-white/60 px-6 py-10 text-center">
      <p className="text-sm font-semibold text-kora-ink">{title}</p>
      {children && <div className="mt-1 text-sm text-muted-foreground">{children}</div>}
    </div>
  );
}

/** Onglets soulignés (maquette : « Vue éditoriale | Analyses | … »). */
export function UnderlineTabs<T extends string>({
  tabs,
  value,
  onChange,
  className,
}: {
  tabs: { value: T; label: string; count?: number }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-6 shadow-[inset_0_-1px_0_color-mix(in_oklab,var(--color-border)_80%,transparent)]",
        className,
      )}
    >
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          onClick={() => onChange(t.value)}
          className={cn(
            "border-b-2 pb-2 text-[13px] transition-colors",
            value === t.value
              ? "border-kora-teal font-semibold text-kora-ink"
              : "border-transparent font-medium text-kora-ink-soft hover:text-kora-ink",
          )}
        >
          {t.label}
          {t.count !== undefined && (
            <span className="ml-1.5 text-[11px] text-muted-foreground tabular-nums">{t.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}

/** Bouton principal teal en dégradé (maquette : « Créer un article »). */
export function PrimaryButton({
  children,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        "kora-btn-primary inline-flex h-9 items-center justify-center gap-2 rounded-lg px-4 text-[13px] font-semibold transition disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
    >
      {children}
    </button>
  );
}

/** Bouton secondaire blanc bordé (maquette : « Ajouter à la newsletter »). */
export function GhostButton({
  children,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        "inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-border bg-white px-3.5 text-[13px] font-medium text-kora-ink shadow-[0_1px_2px_oklch(0.289_0.062_263.9/5%)] transition hover:border-kora-teal-light hover:bg-kora-teal-bg disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
    >
      {children}
    </button>
  );
}
