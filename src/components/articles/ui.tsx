import { useNavigate } from "@tanstack/react-router";
import {
  AlertTriangle,
  Check,
  CircleAlert,
  Info,
  RefreshCw,
  X,
  type LucideIcon,
} from "lucide-react";
import { useState, type MouseEvent, type ReactNode } from "react";
import { GhostButton, Pill } from "@/components/kora/primitives";
import { TONE_CLASSES, scoreOn10, scoreTone, type Tone } from "@/components/kora/labels";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/hooks";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Bandeaux d'information                                              */
/* ------------------------------------------------------------------ */

const BANNER = {
  info: { box: "border-kora-teal-light/50 bg-kora-teal-bg", icon: "text-kora-teal", Icon: Info },
  warning: {
    box: "border-kora-amber/30 bg-kora-amber-bg",
    icon: "text-kora-amber",
    Icon: AlertTriangle,
  },
  danger: { box: "border-kora-rose/25 bg-kora-rose-bg", icon: "text-kora-rose", Icon: CircleAlert },
  success: { box: "border-kora-green/25 bg-kora-green-bg", icon: "text-kora-green", Icon: Check },
} as const;

export type BannerTone = keyof typeof BANNER;

export function Banner({
  tone = "info",
  title,
  children,
  icon,
  action,
  className,
}: {
  tone?: BannerTone;
  title?: ReactNode;
  children?: ReactNode;
  icon?: LucideIcon | undefined;
  action?: ReactNode;
  className?: string | undefined;
}) {
  const t = BANNER[tone];
  const Icon = icon ?? t.Icon;
  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-[12.5px] leading-snug text-kora-ink-soft",
        t.box,
        className,
      )}
    >
      <Icon className={cn("mt-px size-4 shrink-0", t.icon)} strokeWidth={2.2} />
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold text-kora-ink">{title}</p>}
        {children && <div className={cn(title ? "mt-0.5" : undefined)}>{children}</div>}
      </div>
      {action && <div className="shrink-0 self-center">{action}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Encadrés pastel du panneau détail (maquette)                        */
/* ------------------------------------------------------------------ */

/** Encadré vert menthe (« Pourquoi c'est intéressant ? »). */
export function MintPanel({
  title,
  icon: Icon,
  children,
  action,
  className,
}: {
  title: ReactNode;
  icon: LucideIcon;
  children: ReactNode;
  action?: ReactNode;
  className?: string | undefined;
}) {
  return (
    <div
      className={cn("rounded-xl border border-kora-green/15 bg-kora-green-bg/45 p-3.5", className)}
    >
      <div className="flex items-center gap-2">
        <Icon className="size-[18px] shrink-0 text-kora-teal" strokeWidth={2} />
        <p className="flex-1 text-[13px] font-bold text-kora-ink">{title}</p>
        {action}
      </div>
      <div className="mt-2.5">{children}</div>
    </div>
  );
}

/** Encadré bleu pâle (« Angle éditorial suggéré »). */
export function SkyPanel({
  title,
  icon: Icon,
  children,
  action,
  className,
}: {
  title: ReactNode;
  icon: LucideIcon;
  children: ReactNode;
  action?: ReactNode;
  className?: string | undefined;
}) {
  return (
    <div
      className={cn("rounded-xl border border-kora-blue/15 bg-kora-blue-bg/55 p-3.5", className)}
    >
      <div className="flex items-center gap-2">
        <Icon className="size-[18px] shrink-0 text-kora-blue" strokeWidth={2} />
        <p className="flex-1 text-[13px] font-bold text-kora-ink">{title}</p>
        {action}
      </div>
      <div className="mt-2.5">{children}</div>
    </div>
  );
}

/** Puce cochée verte (cercle plein) des listes de la maquette. */
export function CheckItem({
  children,
  tone = "green",
}: {
  children: ReactNode;
  tone?: "green" | "amber" | "rose";
}) {
  const bg =
    tone === "green" ? "bg-kora-green" : tone === "amber" ? "bg-kora-amber" : "bg-kora-rose";
  return (
    <li className="flex items-start gap-2.5 text-[12.5px] leading-snug text-kora-ink-soft">
      <span
        className={cn(
          "mt-px inline-flex size-[18px] shrink-0 items-center justify-center rounded-full text-white",
          bg,
        )}
      >
        {tone === "green" ? (
          <Check className="size-3" strokeWidth={3.2} />
        ) : (
          <span className="text-[11px] leading-none font-bold">!</span>
        )}
      </span>
      <span className="min-w-0">{children}</span>
    </li>
  );
}

/** Boîte « 9.2/10 Score IA » du panneau détail. */
const SCORE_BORDER: Record<Tone, string> = {
  rose: "border-kora-rose/20",
  orange: "border-kora-orange/20",
  amber: "border-kora-amber/25",
  green: "border-kora-green/20",
  blue: "border-kora-blue/20",
  purple: "border-kora-purple/20",
  teal: "border-kora-teal/20",
  gray: "border-border",
};

export function ScoreBox({ total, label = "Score IA" }: { total: number; label?: string }) {
  const tone = scoreTone(total);
  const t = TONE_CLASSES[tone];
  return (
    <div
      className={cn(
        "flex shrink-0 flex-col items-center justify-center rounded-xl border px-4 py-2",
        t.bg,
        SCORE_BORDER[tone],
      )}
    >
      <p className={cn("leading-none font-bold tabular-nums", t.fg)}>
        <span className="text-[26px]">{scoreOn10(total)}</span>
        <span className="text-[15px]">/10</span>
      </p>
      <p className="mt-1 flex items-center gap-1 text-[11px] text-kora-ink-soft">
        {label} <Info className="size-3" />
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Typographie, méta, champs                                           */
/* ------------------------------------------------------------------ */

export function SectionTitle({
  children,
  icon: Icon,
  action,
  className,
}: {
  children: ReactNode;
  icon?: LucideIcon | undefined;
  action?: ReactNode;
  className?: string | undefined;
}) {
  return (
    <div className={cn("mb-2.5 flex items-center justify-between gap-3", className)}>
      <h3 className="flex items-center gap-2 text-[14px] font-bold text-kora-ink">
        {Icon && <Icon className="size-4 text-kora-teal" strokeWidth={2.2} />}
        {children}
      </h3>
      {action}
    </div>
  );
}

/** Ligne de méta-données (date · média · durée · lien) séparées par des filets. */
export function MetaRow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] text-kora-ink-soft [&>*:not(:first-child)]:border-l [&>*:not(:first-child)]:border-border [&>*:not(:first-child)]:pl-4",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Meta({ icon: Icon, children }: { icon?: LucideIcon; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {Icon && <Icon className="size-3.5 text-kora-ink-soft" strokeWidth={2} />}
      {children}
    </span>
  );
}

export const inputClass =
  "rounded-lg border-border bg-white text-[13px] text-kora-ink shadow-none placeholder:text-muted-foreground/80 focus-visible:border-kora-teal-light focus-visible:ring-2 focus-visible:ring-kora-teal-light/40 md:text-[13px]";

export function Field({
  label,
  hint,
  htmlFor,
  aside,
  children,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  htmlFor?: string | undefined;
  aside?: ReactNode;
  children: ReactNode;
  className?: string | undefined;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={htmlFor} className="text-[12px] font-semibold text-kora-ink-soft">
          {label}
        </label>
        {aside && <span className="text-[11px] text-muted-foreground tabular-nums">{aside}</span>}
      </div>
      {children}
      {hint && <p className="text-[11px] leading-snug text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Saisie de libellés (catégories, tags, hashtags) sous forme de pastilles. */
export function TagInput({
  value,
  onChange,
  placeholder,
  disabled,
  tone = "blue",
  id,
  format = (v) => v,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  tone?: Tone;
  id?: string;
  format?: (v: string) => string;
}) {
  const [text, setText] = useState("");
  const add = (raw: string) => {
    const next = raw
      .split(/[,;\n]/)
      .map((s) => s.trim())
      .filter((s) => s && !value.includes(s));
    if (next.length) onChange([...value, ...next]);
    setText("");
  };
  return (
    <div
      className={cn(
        "flex min-h-9 flex-wrap items-center gap-1.5 rounded-lg border border-border bg-white px-2 py-1.5 transition focus-within:border-kora-teal-light focus-within:ring-2 focus-within:ring-kora-teal-light/40",
        disabled && "opacity-60",
      )}
    >
      {value.map((v) => (
        <Pill key={v} tone={tone} className="py-0.5 pr-1.5">
          {format(v)}
          {!disabled && (
            <button
              type="button"
              aria-label={`Retirer ${v}`}
              onClick={() => onChange(value.filter((x) => x !== v))}
              className="rounded-sm opacity-70 transition hover:opacity-100"
            >
              <X className="size-3" />
            </button>
          )}
        </Pill>
      ))}
      <input
        id={id}
        value={text}
        disabled={disabled}
        onChange={(e) => {
          const t = e.target.value;
          if (/[,;]/.test(t)) add(t);
          else setText(t);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add(text);
          } else if (e.key === "Backspace" && !text && value.length) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={() => text.trim() && add(text)}
        placeholder={value.length ? "" : placeholder}
        className="min-w-[7rem] flex-1 bg-transparent px-1 text-[13px] text-kora-ink outline-none placeholder:text-muted-foreground/80"
      />
    </div>
  );
}

/** Bascule à deux options (ex. Édition / Aperçu). */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string; icon?: LucideIcon }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded-lg border border-border bg-white p-0.5">
      {options.map((o) => {
        const Icon = o.icon;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] font-medium transition",
              value === o.value
                ? "bg-kora-teal-bg text-kora-teal-dark"
                : "text-kora-ink-soft hover:text-kora-ink",
            )}
          >
            {Icon && <Icon className="size-3.5" />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Lien interne vers une route hors du périmètre Studio (URL brute, navigation SPA). */
export function HrefLink({
  href,
  children,
  className,
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  const navigate = useNavigate();
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    void navigate({ href });
  };
  return (
    <a
      href={href}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 font-medium text-kora-teal transition hover:text-kora-teal-dark",
        className,
      )}
    >
      {children}
    </a>
  );
}

/* ------------------------------------------------------------------ */
/* Chargement & erreurs                                                */
/* ------------------------------------------------------------------ */

export function LoadError({
  error,
  onRetry,
  title = "Chargement impossible",
  className,
}: {
  error: unknown;
  onRetry?: () => void;
  title?: string;
  className?: string;
}) {
  const notReady = error instanceof ApiError && error.status === 501;
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-xl border border-dashed border-kora-rose/30 bg-kora-rose-bg/35 px-6 py-8 text-center",
        className,
      )}
    >
      <CircleAlert className="size-5 text-kora-rose" />
      <p className="mt-2 text-sm font-semibold text-kora-ink">
        {notReady ? "Service en cours de mise en route" : title}
      </p>
      <p className="mt-1 max-w-md text-xs text-muted-foreground">{errorMessage(error)}</p>
      {onRetry && (
        <GhostButton className="mt-3 h-8 text-xs" onClick={onRetry}>
          <RefreshCw className="size-3.5" /> Réessayer
        </GhostButton>
      )}
    </div>
  );
}

export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="rounded-xl border border-border bg-white/70 p-3">
          <div className="flex items-center gap-2.5">
            <Skeleton className="size-8 rounded-lg" />
            <Skeleton className="h-3 flex-1" />
            <Skeleton className="h-5 w-16 rounded-md" />
          </div>
          <Skeleton className="mt-2.5 h-3 w-11/12" />
          <Skeleton className="mt-1.5 h-3 w-2/3" />
        </div>
      ))}
    </div>
  );
}

export function DetailSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="kora-card p-4">
        <div className="flex items-start gap-3.5">
          <Skeleton className="size-14 rounded-xl" />
          <div className="flex-1">
            <Skeleton className="h-4 w-40" />
            <div className="mt-2 flex gap-1.5">
              <Skeleton className="h-6 w-20 rounded-md" />
              <Skeleton className="h-6 w-16 rounded-md" />
              <Skeleton className="h-6 w-24 rounded-md" />
            </div>
          </div>
          <Skeleton className="h-16 w-24 rounded-xl" />
        </div>
        <Skeleton className="mt-4 h-5 w-3/4" />
        <Skeleton className="mt-3 h-3 w-1/2" />
        <div className="mt-4 grid grid-cols-4 gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-9 rounded-lg" />
          ))}
        </div>
      </div>
      <div className="kora-card p-4">
        <div className="flex gap-6 border-b border-border/80 pb-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-3.5 w-20" />
          ))}
        </div>
        <Skeleton className="mt-4 h-9 w-full rounded-lg" />
        <Skeleton className="mt-3 h-20 w-full rounded-lg" />
        <Skeleton className="mt-3 h-64 w-full rounded-lg" />
      </div>
    </div>
  );
}

/** Lien de téléchargement à l'apparence d'un `GhostButton`. */
export function GhostLink({
  href,
  children,
  download,
  onClick,
  className,
}: {
  href: string;
  children: ReactNode;
  download?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <a
      href={href}
      onClick={onClick}
      download={download ? "" : undefined}
      className={cn(
        "inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-border bg-white px-3.5 text-[13px] font-medium text-kora-ink shadow-[0_1px_2px_oklch(0.289_0.062_263.9/5%)] transition hover:border-kora-teal-light hover:bg-kora-teal-bg",
        className,
      )}
    >
      {children}
    </a>
  );
}

/** Petit bouton icône carré (monter / descendre / retirer). */
export function IconButton({
  label,
  icon: Icon,
  onClick,
  disabled,
  tone = "default",
}: {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  disabled?: boolean;
  tone?: "default" | "danger";
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex size-7 items-center justify-center rounded-md border border-border bg-white text-kora-ink-soft transition disabled:pointer-events-none disabled:opacity-40",
        tone === "danger"
          ? "hover:border-kora-rose/30 hover:bg-kora-rose-bg hover:text-kora-rose"
          : "hover:border-kora-teal-light hover:bg-kora-teal-bg hover:text-kora-teal-dark",
      )}
    >
      <Icon className="size-3.5" strokeWidth={2.2} />
    </button>
  );
}
