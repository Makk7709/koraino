import {
  Ban,
  CalendarDays,
  CircleCheck,
  Clock3,
  ExternalLink,
  FileText,
  Lightbulb,
  Mail,
  MailCheck,
  PenLine,
  RotateCcw,
  Sparkle,
} from "lucide-react";
import { useState } from "react";
import { LinkedInIcon } from "@/components/layout/Artwork";
import { BrandMark } from "@/components/kora/BrandMark";
import {
  TONE_CLASSES,
  formatDate,
  scoreOn10,
  scoreTone,
  type Tone,
} from "@/components/kora/labels";
import { EmptyState, GhostButton, Pill, PrimaryButton } from "@/components/kora/primitives";
import { Skeleton } from "@/components/ui/skeleton";
import { useSignal } from "@/lib/api/hooks";
import type { ScoreResult, SignalDetail } from "@/lib/api/types";
import { cn } from "@/lib/utils";
import { useSignalActions } from "./hooks";
import { HrefLink } from "./links";
import { ReasonDialog } from "./ReasonDialog";
import { ScoreInfoTooltip } from "./ScoreInfoTooltip";
import { signalDate, tagTone } from "./signal-utils";

const ANGLE_TONES: Tone[] = ["purple", "blue", "purple", "blue"];
const UNKNOWN_BRAND = { initials: "?", bg: "oklch(0.3 0.05 230)", fg: "oklch(0.95 0.02 200)" };

/** Panneau détail du signal sélectionné (dashboard + page Signaux). */
export function SignalDetailCard({
  signalId,
  className,
}: {
  signalId: string | null | undefined;
  className?: string;
}) {
  const q = useSignal(signalId);

  if (!signalId) {
    return (
      <section className={cn("kora-card flex items-center justify-center p-6", className)}>
        <EmptyState title="Aucune actualité sélectionnée">
          Sélectionnez une ligne pour afficher le détail, l&apos;angle suggéré et les actions.
        </EmptyState>
      </section>
    );
  }
  if (q.isError) {
    return (
      <section className={cn("kora-card p-6", className)}>
        <EmptyState title="Détail indisponible">
          Le signal n&apos;a pas pu être chargé.{" "}
          <button
            type="button"
            className="font-semibold text-kora-teal hover:underline"
            onClick={() => void q.refetch()}
          >
            Réessayer
          </button>
        </EmptyState>
      </section>
    );
  }
  if (!q.data) return <SignalDetailSkeleton className={className} />;
  return <SignalDetailView signal={q.data} className={className} />;
}

export function SignalDetailView({
  signal,
  className,
}: {
  signal: SignalDetail;
  className?: string | undefined;
}) {
  const company = signal.company;
  const name = company?.name ?? "Entreprise à rattacher";
  return (
    <section className={cn("kora-card @container flex flex-col p-4", className)}>
      <header className="flex items-start gap-3.5">
        <BrandMark
          name={company?.name ?? name}
          brand={company?.brand ?? UNKNOWN_BRAND}
          size="lg"
          className="shadow-[0_6px_16px_-8px_oklch(0.27_0.05_233/70%)]"
        />
        <div className="min-w-0 flex-1 pt-0.5">
          <p
            className={cn(
              "truncate text-[17px] leading-tight font-bold",
              company ? "text-kora-ink" : "text-kora-amber",
            )}
          >
            {name}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {signal.tags.map((t) => (
              <Pill key={t} tone={tagTone(t)} className="px-2 py-0.5 text-[11px]">
                {t}
              </Pill>
            ))}
          </div>
        </div>
        <ScoreBox score={signal.score} />
      </header>

      <h3 className="mt-3 text-[18px] leading-snug font-bold tracking-tight text-kora-ink">
        {signal.title}
      </h3>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] text-kora-ink-soft">
        <span className="inline-flex items-center gap-1.5">
          <CalendarDays className="size-3.5" />
          {formatDate(signalDate(signal))}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <BrandMark
            name={signal.primaryOutlet.name}
            brand={signal.primaryOutlet.brand}
            size="xs"
          />
          {signal.primaryOutlet.name}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Clock3 className="size-3.5" />
          {signal.readingMinutes} min de lecture
        </span>
        <span aria-hidden className="hidden h-4 w-px bg-border @min-[420px]:block" />
        <a
          href={signal.primaryUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-1.5 font-medium text-kora-teal hover:text-kora-teal-dark hover:underline"
        >
          <ExternalLink className="size-3.5" />
          Voir la source
        </a>
      </div>

      <p className="mt-2.5 text-[13px] leading-relaxed text-kora-ink-soft">{signal.summary}</p>

      <div className="mt-3.5 grid gap-3 @min-[380px]:grid-cols-2">
        <div className="rounded-xl border border-kora-green/15 bg-[oklch(0.975_0.02_165)] p-3">
          <p className="flex items-center gap-2 text-[13px] font-bold text-kora-ink">
            <Sparkle className="size-4 fill-kora-teal-light/40 text-kora-teal" />
            Pourquoi c&apos;est intéressant ?
          </p>
          <ul className="mt-2 space-y-1.5">
            {signal.whyInteresting.map((w) => (
              <li
                key={w}
                className="flex items-start gap-2 text-[12px] leading-snug text-kora-ink-soft"
              >
                <CircleCheck className="mt-px size-4 shrink-0 fill-kora-green text-white" />
                {w}
              </li>
            ))}
            {signal.whyInteresting.length === 0 && (
              <li className="text-[12px] text-muted-foreground">Analyse en attente.</li>
            )}
          </ul>
        </div>
        <div className="rounded-xl border border-kora-blue/15 bg-[oklch(0.97_0.016_250)] p-3">
          <p className="flex items-center gap-2 text-[13px] font-bold text-kora-ink">
            <Lightbulb className="size-4 text-kora-blue" />
            Angle éditorial suggéré
          </p>
          <p className="mt-2 text-[12.5px] leading-snug font-medium text-kora-ink">
            {signal.suggestedAngle.text ? `« ${signal.suggestedAngle.text} »` : "—"}
          </p>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {signal.suggestedAngle.tags.map((t, i) => (
              <Pill
                key={t}
                tone={ANGLE_TONES[i % ANGLE_TONES.length] ?? "blue"}
                size="sm"
                className="rounded-md px-2 py-0.5"
              >
                {t}
              </Pill>
            ))}
          </div>
        </div>
      </div>

      <SignalActionBar signal={signal} />
    </section>
  );
}

/** Boîte « 9.2/10 · Score IA ⓘ ». */
export function ScoreBox({ score, className }: { score: ScoreResult; className?: string }) {
  const t = TONE_CLASSES[scoreTone(score.total)];
  return (
    <div
      className={cn(
        "flex shrink-0 flex-col items-center rounded-xl border border-current/10 px-3.5 py-2",
        t.bg,
        className,
      )}
    >
      <p className={cn("leading-none font-extrabold tabular-nums", t.fg)}>
        <span className="text-[27px] tracking-tight">{scoreOn10(score.total)}</span>
        <span className="text-[15px]">/10</span>
      </p>
      <p className="mt-1 flex items-center gap-1 text-[11px] font-medium text-kora-ink-soft">
        Score IA <ScoreInfoTooltip score={score} side="left" />
      </p>
    </div>
  );
}

/** Barre d'actions : article, newsletter, LinkedIn, ignorer / restaurer. */
export function SignalActionBar({ signal }: { signal: SignalDetail }) {
  const actions = useSignalActions();
  const [rejectOpen, setRejectOpen] = useState(false);
  const rejected = signal.status === "rejete";
  const btn = "h-8 min-w-0 flex-auto gap-1.5 px-2 text-[11px] whitespace-nowrap";

  return (
    <div className="mt-3.5 flex flex-wrap gap-1.5 min-[1500px]:flex-nowrap">
      {signal.articleId ? (
        <HrefLink
          href={`/articles?id=${encodeURIComponent(signal.articleId)}`}
          className={cn(
            "kora-btn-primary inline-flex items-center justify-center gap-2 rounded-lg font-semibold",
            btn,
          )}
        >
          <FileText className="size-3.5" />
          Ouvrir l&apos;article
        </HrefLink>
      ) : (
        <PrimaryButton
          className={btn}
          disabled={actions.createArticle.isPending}
          onClick={() =>
            actions.createArticle.mutate({
              signalId: signal.id,
              angle: signal.suggestedAngle.text || undefined,
            })
          }
        >
          <PenLine className="size-3.5" />
          {actions.createArticle.isPending ? "Création…" : "Créer un article"}
        </PrimaryButton>
      )}
      <GhostButton
        className={cn(btn, signal.inNewsletter && "border-kora-teal-light bg-kora-teal-bg")}
        aria-pressed={signal.inNewsletter}
        disabled={actions.toggleNewsletter.isPending}
        onClick={() =>
          actions.toggleNewsletter.mutate({ signalId: signal.id, include: !signal.inNewsletter })
        }
      >
        {signal.inNewsletter ? (
          <MailCheck className="size-3.5 text-kora-teal" />
        ) : (
          <Mail className="size-3.5" />
        )}
        {signal.inNewsletter ? "Dans la newsletter" : "Ajouter à la newsletter"}
      </GhostButton>
      <GhostButton
        className={btn}
        disabled={actions.createLinkedIn.isPending}
        onClick={() => actions.createLinkedIn.mutate(signal.id)}
      >
        <span className="inline-flex size-4 items-center justify-center rounded-[3px] bg-kora-linkedin text-white">
          <LinkedInIcon className="size-2.5" />
        </span>
        {actions.createLinkedIn.isPending ? "Génération…" : "Générer le post LinkedIn"}
      </GhostButton>
      {rejected ? (
        <GhostButton
          className={btn}
          disabled={actions.setStatus.isPending}
          onClick={() => actions.setStatus.mutate({ signalId: signal.id, status: "a_traiter" })}
        >
          <RotateCcw className="size-3.5" />
          Restaurer
        </GhostButton>
      ) : (
        <GhostButton className={btn} onClick={() => setRejectOpen(true)}>
          <Ban className="size-3.5" />
          Ignorer
        </GhostButton>
      )}
      <ReasonDialog
        open={rejectOpen}
        onOpenChange={setRejectOpen}
        title="Ignorer ce signal"
        description="Le signal passe au statut « Rejeté ». Indiquez le motif : il est conservé dans le journal des décisions."
        confirmLabel="Ignorer le signal"
        pending={actions.reject.isPending}
        onConfirm={(reason) =>
          actions.reject.mutate(
            { signalId: signal.id, reason },
            { onSuccess: () => setRejectOpen(false) },
          )
        }
      />
    </div>
  );
}

export function SignalDetailSkeleton({ className }: { className?: string | undefined }) {
  return (
    <section className={cn("kora-card p-4", className)} aria-busy>
      <div className="flex items-start gap-3.5">
        <Skeleton className="size-14 rounded-xl" />
        <div className="flex-1 space-y-2 pt-1">
          <Skeleton className="h-4 w-28" />
          <div className="flex gap-1.5">
            <Skeleton className="h-5 w-16" />
            <Skeleton className="h-5 w-16" />
            <Skeleton className="h-5 w-20" />
          </div>
        </div>
        <Skeleton className="h-[62px] w-[78px] rounded-xl" />
      </div>
      <Skeleton className="mt-4 h-5 w-[85%]" />
      <Skeleton className="mt-3 h-3 w-[60%]" />
      <Skeleton className="mt-3 h-3 w-full" />
      <Skeleton className="mt-1.5 h-3 w-[90%]" />
      <div className="mt-4 grid grid-cols-2 gap-3">
        <Skeleton className="h-28 rounded-xl" />
        <Skeleton className="h-28 rounded-xl" />
      </div>
      <div className="mt-4 flex gap-2">
        <Skeleton className="h-8 w-32 rounded-lg" />
        <Skeleton className="h-8 w-40 rounded-lg" />
        <Skeleton className="h-8 w-40 rounded-lg" />
      </div>
    </section>
  );
}
