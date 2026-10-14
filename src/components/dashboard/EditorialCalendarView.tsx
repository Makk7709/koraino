import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { fr } from "date-fns/locale";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { TONE_CLASSES, WORDPRESS_STATUS, formatDate, type Tone } from "@/components/kora/labels";
import { KoraCard } from "@/components/kora/primitives";
import { HrefLink } from "@/components/signals/links";
import { Skeleton } from "@/components/ui/skeleton";
import { useArticles, useLinkedInPosts, useNewsletters } from "@/lib/api/hooks";
import type { Article, LinkedInPost, NewsletterEdition } from "@/lib/api/types";
import { cn } from "@/lib/utils";

type Kind = "programme" | "publie" | "wp" | "wp_relecture" | "newsletter" | "linkedin";

const KIND: Record<Kind, { label: string; tone: Tone }> = {
  programme: { label: "Article programmé", tone: "teal" },
  publie: { label: "Article publié", tone: "green" },
  wp: { label: WORDPRESS_STATUS.brouillon.label, tone: "blue" },
  wp_relecture: {
    label: `WordPress : ${WORDPRESS_STATUS.en_attente.label.toLowerCase()}`,
    tone: "orange",
  },
  linkedin: { label: "Post LinkedIn", tone: "purple" },
  newsletter: { label: "Édition newsletter", tone: "amber" },
};

interface CalEvent {
  key: string;
  date: Date;
  kind: Kind;
  title: string;
  href: string;
}

const WEEKDAYS = ["lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim."];

function articleEvents(a: Article): CalEvent[] {
  const href = `/articles?id=${encodeURIComponent(a.id)}`;
  const out: CalEvent[] = [];
  for (const ap of a.approvals) {
    if (ap.valid && ap.scheduledAt && ap.channel === "wordpress")
      out.push({
        key: `${a.id}-${ap.id}`,
        date: new Date(ap.scheduledAt),
        kind: "programme",
        title: a.title,
        href,
      });
  }
  if (a.status === "publie") {
    const d = a.wordpress.lastSyncAt ?? a.updatedAt;
    out.push({ key: `${a.id}-pub`, date: new Date(d), kind: "publie", title: a.title, href });
  } else if (
    (a.wordpress.status === "brouillon" || a.wordpress.status === "en_attente") &&
    a.wordpress.lastSyncAt
  ) {
    out.push({
      key: `${a.id}-wp`,
      date: new Date(a.wordpress.lastSyncAt),
      kind: a.wordpress.status === "brouillon" ? "wp" : "wp_relecture",
      title: a.title,
      href,
    });
  }
  return out;
}

function linkedinEvents(p: LinkedInPost): CalEvent[] {
  const href = `/linkedin?id=${encodeURIComponent(p.id)}`;
  if (p.approval?.valid && p.approval.scheduledAt)
    return [
      { key: p.id, date: new Date(p.approval.scheduledAt), kind: "linkedin", title: p.title, href },
    ];
  if (p.status === "exporte" || p.status === "publie")
    return [{ key: p.id, date: new Date(p.updatedAt), kind: "linkedin", title: p.title, href }];
  return [];
}

function newsletterEvents(n: NewsletterEdition): CalEvent[] {
  const d = n.approval?.scheduledAt ?? n.weekOf;
  return [
    { key: n.id, date: new Date(d), kind: "newsletter", title: n.title, href: "/newsletter" },
  ];
}

/** Onglet « Calendrier éditorial » : articles programmés/publiés, posts et éditions. */
export function EditorialCalendarView({ initialMonth }: { initialMonth: Date }) {
  const [month, setMonth] = useState(() => startOfMonth(initialMonth));
  const articles = useArticles();
  const posts = useLinkedInPosts();
  const editions = useNewsletters();
  const loading = articles.isPending || posts.isPending || editions.isPending;

  const events = useMemo(
    () =>
      [
        ...(articles.data ?? []).flatMap(articleEvents),
        ...(posts.data ?? []).flatMap(linkedinEvents),
        ...(editions.data ?? []).flatMap(newsletterEvents),
      ].sort((a, b) => a.date.getTime() - b.date.getTime()),
    [articles.data, posts.data, editions.data],
  );

  const days = useMemo(
    () =>
      eachDayOfInterval({
        start: startOfWeek(startOfMonth(month), { weekStartsOn: 1 }),
        end: endOfWeek(endOfMonth(month), { weekStartsOn: 1 }),
      }),
    [month],
  );
  const today = startOfDay(new Date());
  const upcoming = events.filter((e) => e.date >= today).slice(0, 8);

  return (
    <div className="grid gap-4 @min-[1000px]:grid-cols-[1fr_300px]">
      <section className="kora-card p-4">
        <header className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-[16px] font-bold text-kora-ink first-letter:uppercase">
            {format(month, "LLLL yyyy", { locale: fr })}
          </h2>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              aria-label="Mois précédent"
              onClick={() => setMonth((m) => addMonths(m, -1))}
              className="inline-flex size-8 items-center justify-center rounded-lg border border-border bg-white text-kora-ink-soft transition hover:border-kora-teal-light hover:text-kora-ink"
            >
              <ChevronLeft className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => setMonth(startOfMonth(new Date()))}
              className="inline-flex h-8 items-center rounded-lg border border-border bg-white px-3 text-[12px] font-medium text-kora-ink transition hover:border-kora-teal-light"
            >
              Aujourd&apos;hui
            </button>
            <button
              type="button"
              aria-label="Mois suivant"
              onClick={() => setMonth((m) => addMonths(m, 1))}
              className="inline-flex size-8 items-center justify-center rounded-lg border border-border bg-white text-kora-ink-soft transition hover:border-kora-teal-light hover:text-kora-ink"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
        </header>

        <div className="grid grid-cols-7 gap-px overflow-hidden rounded-xl border border-border bg-border">
          {WEEKDAYS.map((d) => (
            <div
              key={d}
              className="bg-muted px-2 py-1.5 text-[11px] font-medium text-muted-foreground uppercase"
            >
              {d}
            </div>
          ))}
          {days.map((day) => {
            const dayEvents = events.filter((e) => isSameDay(e.date, day));
            const inMonth = isSameMonth(day, month);
            const isToday = isSameDay(day, today);
            return (
              <div
                key={day.toISOString()}
                className={cn("min-h-[96px] bg-white p-1.5", !inMonth && "bg-white/60")}
              >
                <span
                  className={cn(
                    "inline-flex size-6 items-center justify-center rounded-full text-[11.5px] font-semibold tabular-nums",
                    isToday
                      ? "bg-kora-teal text-white"
                      : inMonth
                        ? "text-kora-ink"
                        : "text-muted-foreground/60",
                  )}
                >
                  {day.getDate()}
                </span>
                <div className="mt-1 space-y-1">
                  {loading && inMonth && day.getDate() % 9 === 3 && (
                    <Skeleton className="h-4 w-full rounded" />
                  )}
                  {dayEvents.slice(0, 3).map((e) => (
                    <EventChip key={e.key} event={e} />
                  ))}
                  {dayEvents.length > 3 && (
                    <p className="px-1 text-[10.5px] font-medium text-muted-foreground">
                      + {dayEvents.length - 3} autre{dayEvents.length - 3 > 1 ? "s" : ""}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <div className="flex flex-col gap-4">
        <KoraCard title="À venir">
          {loading ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-10 w-full rounded-lg" />
              ))}
            </div>
          ) : upcoming.length === 0 ? (
            <p className="text-[12.5px] text-muted-foreground">
              Aucune publication programmée pour le moment.
            </p>
          ) : (
            <ul className="space-y-2">
              {upcoming.map((e) => (
                <li key={e.key}>
                  <HrefLink
                    href={e.href}
                    className="flex gap-2.5 rounded-lg border border-border bg-white px-2.5 py-2 transition hover:border-kora-teal-light"
                  >
                    <span
                      className={cn(
                        "mt-1 size-2 shrink-0 rounded-full",
                        TONE_CLASSES[KIND[e.kind].tone].solid,
                      )}
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-[12.5px] font-semibold text-kora-ink">
                        {e.title}
                      </span>
                      <span className="block text-[11px] text-muted-foreground">
                        {KIND[e.kind].label} · {formatDate(e.date.toISOString())}
                      </span>
                    </span>
                  </HrefLink>
                </li>
              ))}
            </ul>
          )}
        </KoraCard>
        <KoraCard title="Légende">
          <ul className="space-y-1.5">
            {(Object.keys(KIND) as Kind[]).map((k) => (
              <li key={k} className="flex items-center gap-2 text-[12px] text-kora-ink-soft">
                <span className={cn("size-2.5 rounded-sm", TONE_CLASSES[KIND[k].tone].solid)} />
                {KIND[k].label}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[11px] leading-snug text-muted-foreground">
            Pilote : WordPress reçoit des brouillons distants, LinkedIn et la newsletter sont
            exportés. Aucun envoi sans approbation valide.
          </p>
        </KoraCard>
      </div>
    </div>
  );
}

function EventChip({ event }: { event: CalEvent }) {
  const t = TONE_CLASSES[KIND[event.kind].tone];
  return (
    <HrefLink
      href={event.href}
      title={`${KIND[event.kind].label} : ${event.title}`}
      className={cn(
        "block truncate rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold transition hover:brightness-95",
        t.bg,
        t.fg,
      )}
    >
      {event.title}
    </HrefLink>
  );
}
