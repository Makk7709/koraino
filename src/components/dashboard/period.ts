import { endOfDay, endOfMonth, startOfDay, startOfMonth, subDays, subMonths } from "date-fns";

export interface Period {
  from: Date;
  to: Date;
}

const dayMonth = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long" });
const monthYear = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" });
const full = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric" });

/** « 1 – 31 octobre 2026 », « 12 septembre – 11 octobre 2026 »… */
export function formatPeriod(p: Period): string {
  const { from, to } = p;
  if (from.getFullYear() === to.getFullYear()) {
    if (from.getMonth() === to.getMonth()) {
      if (from.getDate() === to.getDate()) return full.format(from);
      return `${from.getDate()} – ${to.getDate()} ${monthYear.format(to)}`;
    }
    return `${dayMonth.format(from)} – ${dayMonth.format(to)} ${to.getFullYear()}`;
  }
  return `${full.format(from)} – ${full.format(to)}`;
}

export function currentMonth(now = new Date()): Period {
  return { from: startOfMonth(now), to: endOfMonth(now) };
}

export const PERIOD_PRESETS: { key: string; label: string; get: (now: Date) => Period }[] = [
  { key: "month", label: "Ce mois-ci", get: (now) => currentMonth(now) },
  {
    key: "prev-month",
    label: "Mois précédent",
    get: (now) => currentMonth(subMonths(now, 1)),
  },
  {
    key: "7d",
    label: "7 derniers jours",
    get: (now) => ({ from: startOfDay(subDays(now, 6)), to: endOfDay(now) }),
  },
  {
    key: "30d",
    label: "30 derniers jours",
    get: (now) => ({ from: startOfDay(subDays(now, 29)), to: endOfDay(now) }),
  },
  {
    key: "90d",
    label: "90 derniers jours",
    get: (now) => ({ from: startOfDay(subDays(now, 89)), to: endOfDay(now) }),
  },
];

/** Paramètres `from` / `to` de l'API (bornes de journée, stables sur la journée). */
export function toApiRange(p: Period): { from: string; to: string } {
  return { from: startOfDay(p.from).toISOString(), to: endOfDay(p.to).toISOString() };
}

export function fromApiRange(r: { from: string; to: string }): Period {
  return { from: new Date(r.from), to: new Date(r.to) };
}
