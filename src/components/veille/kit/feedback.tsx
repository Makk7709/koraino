import { CircleAlert, Info, RotateCw, TriangleAlert } from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { TONE_CLASSES, type Tone } from "@/components/kora/labels";
import { ApiError } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/hooks";
import { cn } from "@/lib/utils";

/** Erreur de chargement d'un bloc, avec relance. */
export function ErrorPanel({
  title = "Chargement impossible",
  error,
  onRetry,
  className,
}: {
  title?: string;
  error: unknown;
  onRetry?: () => void;
  className?: string;
}) {
  const status = error instanceof ApiError ? error.status : null;
  return (
    <div
      role="alert"
      className={cn(
        "flex items-start gap-3 rounded-xl border border-kora-rose/25 bg-kora-rose-bg/60 px-4 py-3.5",
        className,
      )}
    >
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-kora-rose" />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-kora-ink">{title}</p>
        <p className="mt-0.5 text-[12px] text-kora-ink-soft">
          {errorMessage(error)}
          {status !== null && (
            <span className="ml-1.5 font-mono text-[11px] text-muted-foreground">
              (HTTP {status})
            </span>
          )}
        </p>
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg border border-border bg-white px-2.5 text-[12px] font-medium text-kora-ink transition hover:border-kora-teal-light hover:bg-kora-teal-bg"
        >
          <RotateCw className="size-3.5" /> Réessayer
        </button>
      )}
    </div>
  );
}

/** Message d'erreur dans un formulaire (ex. 422 du serveur). */
export function InlineError({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-lg border border-kora-rose/30 bg-kora-rose-bg/70 px-3 py-2 text-[12px] text-kora-ink"
    >
      <CircleAlert className="mt-px size-3.5 shrink-0 text-kora-rose" />
      <div className="min-w-0">
        {title && <p className="font-semibold">{title}</p>}
        <div className="text-kora-ink-soft">{children}</div>
      </div>
    </div>
  );
}

/** Encadré de rappel (règle métier, conformité). */
export function Notice({
  tone = "teal",
  icon: Icon = Info,
  title,
  children,
  className,
}: {
  tone?: Tone;
  icon?: ComponentType<{ className?: string }>;
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const t = TONE_CLASSES[tone];
  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-xl border border-border/70 px-3.5 py-2.5 text-[12px]",
        t.bg,
        className,
      )}
    >
      <Icon className={cn("mt-px size-4 shrink-0", t.fg)} />
      <div className="min-w-0 text-kora-ink-soft">
        {title && <p className="font-semibold text-kora-ink">{title}</p>}
        {children}
      </div>
    </div>
  );
}

export function TableSkeleton({ rows = 6, cols = 6 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-2" aria-busy="true" aria-label="Chargement">
      <Skeleton className="h-8 w-full rounded-lg bg-secondary" />
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 border-b border-border/60 px-3 py-2.5">
          <Skeleton className="size-9 shrink-0 rounded-lg" />
          {Array.from({ length: cols - 1 }).map((__, j) => (
            <Skeleton key={j} className={cn("h-3.5", j === 1 ? "flex-[2]" : "flex-1")} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function CardGridSkeleton({ count = 6, className }: { count?: number; className?: string }) {
  return (
    <div className={cn("grid gap-4", className)} aria-busy="true" aria-label="Chargement">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="kora-card space-y-3 p-4">
          <div className="flex items-center gap-3">
            <Skeleton className="size-10 rounded-lg" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-2/3" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
          <Skeleton className="h-3 w-4/5" />
          <div className="flex gap-1.5">
            <Skeleton className="h-5 w-20 rounded-md" />
            <Skeleton className="h-5 w-16 rounded-md" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function BlockSkeleton({ className }: { className?: string }) {
  return <Skeleton className={cn("rounded-xl", className)} />;
}
