export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

/** Minuit (heure locale) du jour situé `daysAgo` jours avant `ref`. */
export function dayStart(ref: Date, daysAgo = 0): Date {
  return new Date(ref.getFullYear(), ref.getMonth(), ref.getDate() - daysAgo);
}

export function addDays(d: Date, days: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days, d.getHours(), d.getMinutes());
}

export function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function monthStart(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function inRange(iso: string | null | undefined, from: Date, to: Date): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  return t >= from.getTime() && t <= to.getTime();
}

export function daysBetween(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / DAY);
}

/** Lundi (00:00, heure locale) de la semaine de `d`. */
export function mondayOf(d: Date): Date {
  const day = (d.getDay() + 6) % 7;
  return dayStart(d, day);
}

export function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : new Date(t);
}
