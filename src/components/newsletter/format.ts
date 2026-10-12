const weekFmt = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

/** Libellé « Semaine du 12 octobre 2026 », identique à l'export serveur. */
export function weekLabel(weekOf: string): string {
  const d = new Date(weekOf);
  return Number.isNaN(d.getTime()) ? "Semaine à définir" : `Semaine du ${weekFmt.format(d)}`;
}
