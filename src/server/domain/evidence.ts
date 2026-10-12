import type { EvidenceState, Observation } from "@/lib/api/types";
import { DAY } from "./dates";
import { extractAmountsM, textSimilarity } from "./text";

/** Seuil au-delà duquel deux extraits sont considérés comme la reprise d'un même communiqué. */
export const SYNDICATION_THRESHOLD = 0.8;

function obsTime(o: Observation): number {
  return Date.parse(o.publishedAt ?? o.collectedAt);
}

/**
 * Marque les reprises : une observation dont l'extrait reproduit celui d'une observation
 * antérieure d'un autre émetteur est une reprise (pas une corroboration indépendante).
 */
export function markSyndication<T extends Observation>(observations: T[]): T[] {
  const sorted = [...observations].sort(
    (a, b) => obsTime(a) - obsTime(b) || a.id.localeCompare(b.id),
  );
  const result = new Map<string, boolean>();
  sorted.forEach((o, i) => {
    const earlier = sorted.slice(0, i);
    const isCopy = earlier.some(
      (e) =>
        e.outlet.domain !== o.outlet.domain &&
        textSimilarity(e.excerpt, o.excerpt) >= SYNDICATION_THRESHOLD,
    );
    result.set(o.id, isCopy);
  });
  return observations.map((o) => ({ ...o, isSyndicated: result.get(o.id) ?? false }));
}

/** Contradictions factuelles détectables (montants divergents entre sources indépendantes). */
export function detectContradictions(observations: Observation[]): string[] {
  const byAmount = new Map<number, string[]>();
  for (const o of observations) {
    if (o.isSyndicated) continue;
    for (const a of new Set(extractAmountsM(`${o.title} ${o.excerpt}`))) {
      const list = byAmount.get(a) ?? [];
      if (!list.includes(o.outlet.name)) list.push(o.outlet.name);
      byAmount.set(a, list);
    }
  }
  if (byAmount.size < 2) return [];
  const parts = [...byAmount.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([amount, outlets]) => `${amount} M€ (${outlets.join(", ")})`);
  return [`Montants divergents selon les sources : ${parts.join(" / ")}`];
}

/**
 * Indicateur documentaire (§3.3) : état explicable du dossier, distinct du score éditorial.
 * Ce n'est pas une probabilité.
 */
export function computeEvidence(
  observations: Observation[],
  company: { name: string; domain: string } | null,
  now: Date,
): EvidenceState {
  const isDirect = (o: Observation) =>
    !!company && (o.outlet.domain === company.domain || hostOf(o.url).endsWith(company.domain));
  const direct = observations.filter(isDirect);
  const directSource = direct.length > 0;

  const external = new Map<string, string>();
  for (const o of observations) {
    if (o.isSyndicated || isDirect(o)) continue;
    external.set(o.outlet.domain, o.outlet.name);
  }
  const independentCorroborations = Math.max(0, external.size - (directSource ? 0 : 1));
  const syndicated = observations.filter((o) => o.isSyndicated);

  const dated = observations
    .map((o) => o.publishedAt ?? o.eventDate)
    .filter((d): d is string => !!d)
    .map((d) => Date.parse(d));
  const freshnessDays = dated.length
    ? Math.max(0, Math.floor((now.getTime() - Math.max(...dated)) / DAY))
    : null;

  const contradictions = detectContradictions(observations);

  let level: EvidenceState["level"];
  if (contradictions.length > 0) level = "fragile";
  else if (directSource && independentCorroborations >= 1) level = "solide";
  else if (directSource || independentCorroborations >= 1) level = "a_consolider";
  else level = "fragile";

  const explanation: string[] = [];
  explanation.push(
    directSource
      ? `Source directe disponible (${direct[0]!.outlet.name})`
      : "Aucune source directe (site officiel ou communiqué de l'entreprise)",
  );
  explanation.push(
    independentCorroborations > 0
      ? `${independentCorroborations} corroboration(s) indépendante(s) : ${[...external.values()].join(", ")}`
      : "Aucune corroboration indépendante",
  );
  if (syndicated.length > 0) {
    explanation.push(
      `${syndicated.length} reprise(s) du même communiqué non comptée(s) : ${[...new Set(syndicated.map((o) => o.outlet.name))].join(", ")}`,
    );
  }
  explanation.push(
    freshnessDays === null
      ? "Date de publication inconnue"
      : freshnessDays === 0
        ? "Publication du jour"
        : `Publication la plus récente il y a ${freshnessDays} jour(s)`,
  );
  for (const c of contradictions) explanation.push(`Contradiction : ${c}`);
  explanation.push("Indicateur documentaire explicable, pas une probabilité de véracité");

  return {
    level,
    directSource,
    independentCorroborations,
    freshnessDays,
    contradictions,
    explanation,
  };
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
