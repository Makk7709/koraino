import type { Category, Observation, Signal } from "@/lib/api/types";
import type { CompanyRecord } from "../store/records";
import { DAY } from "./dates";
import { hostOf, SYNDICATION_THRESHOLD } from "./evidence";
import { containsPhrase, normalize, stripAccents, textSimilarity } from "./text";

/** Seuil de rattachement : en dessous, l'observation reste « à rattacher ». */
export const MATCH_THRESHOLD = 60;
/** Fenêtre de regroupement d'un même événement. */
export const CLUSTER_WINDOW_DAYS = 7;
export const CLUSTER_SIMILARITY = 0.5;
export const UNCERTAIN_SIMILARITY = 0.3;

const CATEGORY_RULES: [Category, RegExp][] = [
  ["financement", /\b(leve|levee|tour de table|financement|serie [abc]|investisseurs?|fonds)\b/],
  ["acquisition", /\b(rachete|rachat|acquisition|acquiert|reprend)\b/],
  ["contrat", /\b(contrat|commande|remporte|appel d'offres)\b/],
  [
    "partenariat",
    /\b(partenariat|s'associent|s'associe|unissent|alliance|collaboration|cooperation)\b/,
  ],
  ["brevet", /\bbrevets?\b/],
  ["recrutement", /\b(recrute|recrutements?|embauche|emplois)\b/],
  ["distinction", /\b(prix|laureate?|recompense|distingue|trophee)\b/],
  [
    "international",
    /\b(international|filiale|allemagne|etats-unis|japon|canada|singapour|export|s'implante|deploie)\b/,
  ],
  [
    "croissance",
    /\b(croissance|chiffre d'affaires|usine|site de production|s'agrandit|double|inaugure)\b/,
  ],
  ["produit", /\b(lance|lancement|gamme|nouveau produit|nouvelle offre|commercialise)\b/],
  ["recherche", /\b(recherche|laboratoire|scientifique|resultats)\b/],
  ["innovation", /\b(innovation|innovante?|technologie|devoile|presente)\b/],
];

/** Classement taxonomique par mots-clés (le texte collecté n'est jamais interprété autrement). */
export function classifyCategory(text: string): Category {
  const t = stripAccents(text.toLowerCase());
  for (const [category, re] of CATEGORY_RULES) if (re.test(t)) return category;
  return "innovation";
}

export interface MatchResult {
  companyId: string | null;
  confidence: number;
  review: Signal["review"];
}

/**
 * Rattachement d'une observation à une entreprise du registre (domaine, raison sociale, alias).
 * `matchConfidence` est une confiance de rattachement, pas une probabilité de véracité.
 */
export function matchCompany(
  text: string,
  url: string,
  companies: CompanyRecord[],
  sourceCompanyId: string | null,
): MatchResult {
  const host = hostOf(url);
  const byDomain = companies.find((c) => host === c.domain || host.endsWith(`.${c.domain}`));
  if (byDomain) return { companyId: byDomain.id, confidence: 97, review: null };

  const candidates = companies.filter((c) =>
    [c.name, ...c.aliases].some((n) => containsPhrase(text, n)),
  );
  const exactName = candidates.filter((c) => containsPhrase(text, c.name));
  if (candidates.length === 1) {
    const c = candidates[0]!;
    const named = exactName.length === 1;
    const confidence = c.id === sourceCompanyId ? (named ? 92 : 84) : named ? 82 : 66;
    return { companyId: c.id, confidence, review: null };
  }
  if (candidates.length > 1) {
    const fromSource = candidates.find((c) => c.id === sourceCompanyId);
    if (fromSource && exactName.length <= 1) {
      return { companyId: fromSource.id, confidence: 70, review: null };
    }
    return {
      companyId: null,
      confidence: 45,
      review: {
        kind: "homonymie",
        note: `Plusieurs entreprises du registre correspondent : ${candidates.map((c) => c.name).join(", ")}`,
      },
    };
  }
  if (sourceCompanyId) {
    const src = companies.find((c) => c.id === sourceCompanyId);
    return {
      companyId: null,
      confidence: 52,
      review: {
        kind: "homonymie",
        note: `La publication ne mentionne pas explicitement ${src?.name ?? "l'entreprise de la source"} : rattachement à confirmer`,
      },
    };
  }
  return {
    companyId: null,
    confidence: 20,
    review: {
      kind: "homonymie",
      note: "Aucune entreprise du registre identifiée dans la publication",
    },
  };
}

export interface ClusterCandidate {
  signal: Pick<Signal, "id" | "companyId" | "category" | "title" | "createdAt" | "eventDate">;
  observations: Observation[];
}

export type ClusterDecision =
  | { kind: "attach"; signalId: string; similarity: number }
  | { kind: "uncertain"; signalId: string; similarity: number }
  | { kind: "new" };

/**
 * Regroupement d'un même événement : même entreprise, même catégorie, titres proches,
 * dans une fenêtre de 7 jours. Une reprise quasi identique d'un communiqué est toujours regroupée.
 */
export function decideCluster(
  obs: Pick<Observation, "companyId" | "title" | "excerpt" | "collectedAt" | "publishedAt">,
  category: Category,
  candidates: ClusterCandidate[],
): ClusterDecision {
  if (!obs.companyId) return { kind: "new" };
  const obsTime = Date.parse(obs.publishedAt ?? obs.collectedAt);
  let best: { id: string; sim: number } | null = null;
  for (const { signal, observations } of candidates) {
    if (signal.companyId !== obs.companyId) continue;
    const ref = Date.parse(signal.eventDate ?? signal.createdAt);
    if (Math.abs(obsTime - ref) > CLUSTER_WINDOW_DAYS * DAY) continue;
    const copy = observations.some(
      (o) => textSimilarity(o.excerpt, obs.excerpt) >= SYNDICATION_THRESHOLD,
    );
    if (copy) return { kind: "attach", signalId: signal.id, similarity: 1 };
    if (signal.category !== category) continue;
    const sim = Math.max(
      textSimilarity(signal.title, obs.title),
      ...observations.map((o) => textSimilarity(o.title, obs.title)),
    );
    if (!best || sim > best.sim) best = { id: signal.id, sim };
  }
  if (best && best.sim >= CLUSTER_SIMILARITY)
    return { kind: "attach", signalId: best.id, similarity: best.sim };
  if (best && best.sim >= UNCERTAIN_SIMILARITY) {
    return { kind: "uncertain", signalId: best.id, similarity: best.sim };
  }
  return { kind: "new" };
}

/** Normalisation d'URL pour la déduplication exacte. */
export function canonicalUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    for (const key of [...u.searchParams.keys()]) {
      if (key.startsWith("utm_")) u.searchParams.delete(key);
    }
    return `${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/$/, "")}${u.search}`.toLowerCase();
  } catch {
    return normalize(url);
  }
}
