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

/**
 * Indices lexicaux par catégorie : un indice fort vaut 3 points, un indice faible 1. La catégorie
 * la mieux notée l'emporte ; à égalité, l'ordre du tableau (financement, acquisition, contrat…)
 * tranche. Les mots ambigus (« prix », « double », « lance », « fonds », « recherche ») ne sont
 * que des indices faibles : seuls, ils ne décident plus de la catégorie.
 */
interface CategoryRule {
  category: Category;
  strong: RegExp[];
  weak: RegExp[];
}

const STRONG = 3;
const WEAK = 1;

const CATEGORY_RULES: CategoryRule[] = [
  {
    category: "financement",
    strong: [
      /\blevee de fonds\b/,
      /\bleve\b[^.]{0,40}\b(?:millions?|m€|meur|k€)/,
      /\btour de table\b/,
      /\bserie [abc]\b/,
      /\binvestisseurs?\b/,
      /\bfonds d'investissement\b/,
      /\bbpifrance\b/,
      /\bboucle (?:un|son) (?:financement|tour)\b/,
    ],
    weak: [/\blevee\b/, /\bleve\b/, /\bfinancement\b/, /\bfonds\b/, /\bcapital\b/],
  },
  {
    category: "acquisition",
    strong: [
      /\brachete\b/,
      /\brachat\b/,
      /\bacquisition\b/,
      /\bacquiert\b/,
      /\breprend\b/,
      /\bfusionne\b/,
    ],
    weak: [/\bcession\b/, /\brepreneur\b/, /\bcede\b/],
  },
  {
    category: "contrat",
    strong: [
      /\bcontrats?\b/,
      /\bremporte\b/,
      /\bappel d'offres\b/,
      /\bcommandes?\b/,
      /\bmarche public\b/,
    ],
    weak: [/\bsigne\b/, /\bselectionne\b/, /\bretenu\b/, /\bfournisseur\b/],
  },
  {
    category: "partenariat",
    strong: [
      /\bpartenariats?\b/,
      /\bs'associent?\b/,
      /\balliance\b/,
      /\bcollaboration\b/,
      /\bcooperation\b/,
      /\bconsortium\b/,
    ],
    weak: [/\bpartenaires?\b/, /\bunissent\b/, /\baux cotes de\b/],
  },
  {
    category: "brevet",
    strong: [/\bbrevets?\b/, /\bpropriete intellectuelle\b/],
    weak: [/\bdepose\b/, /\bprotege\b/],
  },
  {
    category: "recrutement",
    strong: [/\brecrute\b/, /\brecrutements?\b/, /\bembauches?\b/, /\bemplois\b/, /\bpostes\b/],
    weak: [/\btalents\b/, /\beffectifs\b/, /\bequipe s'agrandit\b/],
  },
  {
    category: "distinction",
    strong: [
      /\blaureate?s?\b/,
      /\brecompens(?:e|ee|es|ees)\b/,
      /\bdistingue(?:e|s|es)?\b/,
      /\btrophees?\b/,
      /\bremporte le prix\b/,
      /\bprix (?:de l'innovation|de l'entrepreneur|du jury|du public|de l'excellence|de l'export)\b/,
      /\bmedaille\b/,
      /\bpalmares\b/,
    ],
    weak: [/\bprix\b/, /\bconcours\b/, /\bclassement\b/],
  },
  {
    category: "international",
    strong: [
      /\bs'implante\b/,
      /\bfiliales?\b/,
      /\bexport(?:e|ation|ations)?\b/,
      /\bouvre un bureau\b/,
      /\bs'installe (?:a|en|au|aux)\b/,
      /\bconquiert\b/,
      /\ba l'international\b/,
    ],
    weak: [
      /\binternational\b/,
      /\bdeploie\b/,
      /\ballemagne\b/,
      /\betats-unis\b/,
      /\bjapon\b/,
      /\bcanada\b/,
      /\bsingapour\b/,
      /\bchine\b/,
      /\broyaume-uni\b/,
    ],
  },
  {
    category: "croissance",
    strong: [
      /\bchiffre d'affaires\b/,
      /\bdouble (?:son|ses|sa)\b/,
      /\bnouvelle usine\b/,
      /\bsite de production\b/,
      /\bs'agrandit\b/,
      /\binaugure\b/,
      /\bcroissance\b/,
    ],
    weak: [/\busine\b/, /\bdouble\b/, /\bagrandissement\b/, /\bextension\b/],
  },
  {
    category: "produit",
    strong: [
      /\blancement\b/,
      /\bnouveau produit\b/,
      /\bnouvelle offre\b/,
      /\bcommercialise\b/,
      /\bnouvelle version\b/,
      /\bmise sur le marche\b/,
    ],
    weak: [/\blance\b/, /\bgamme\b/, /\bdevoile\b/, /\bsolution\b/],
  },
  {
    category: "recherche",
    strong: [
      /\blaboratoire\b/,
      /\bchercheurs?\b/,
      /\bpublication scientifique\b/,
      /\bprojet de recherche\b/,
      /\btheses?\b/,
      /\bcnrs\b/,
      /\binria\b/,
      /\buniversite\b/,
    ],
    weak: [/\brecherche\b/, /\bscientifique\b/, /\bresultats\b/, /\betude\b/],
  },
  {
    category: "innovation",
    strong: [/\binnovation\b/, /\binnovante?s?\b/, /\brupture\b/, /\bpremiere mondiale\b/],
    weak: [/\btechnologie\b/, /\bpresente\b/, /\bdevoile\b/, /\bprototype\b/],
  },
];

function categoryScore(rule: CategoryRule, text: string): number {
  const strong = rule.strong.filter((re) => re.test(text)).length;
  const weak = rule.weak.filter((re) => re.test(text)).length;
  return strong * STRONG + weak * WEAK;
}

/**
 * Classement taxonomique par indices lexicaux pondérés (le texte collecté n'est jamais interprété
 * autrement) ; « innovation » à défaut d'indice. Repli de l'évaluation par le modèle.
 */
export function classifyCategory(text: string): Category {
  const t = stripAccents(text.toLowerCase()).replace(/[’']/g, "'");
  let best: { category: Category; score: number } | null = null;
  for (const rule of CATEGORY_RULES) {
    const score = categoryScore(rule, t);
    if (score > 0 && (!best || score > best.score)) best = { category: rule.category, score };
  }
  return best?.category ?? "innovation";
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
