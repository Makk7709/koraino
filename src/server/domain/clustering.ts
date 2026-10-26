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
      /\baccords?\b/,
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
  signal: Pick<
    Signal,
    "id" | "companyId" | "category" | "title" | "createdAt" | "eventDate" | "publishedAt"
  >;
  observations: Observation[];
}

export type ClusterDecision =
  | { kind: "attach"; signalId: string; similarity: number }
  | { kind: "uncertain"; signalId: string; similarity: number }
  | { kind: "new" };

/** Date de référence d'un signal pour le regroupement : événement, sinon publication la plus ancienne, sinon création. */
export function clusterReference(
  signal: Pick<Signal, "createdAt" | "eventDate" | "publishedAt">,
): number {
  return Date.parse(signal.eventDate ?? signal.publishedAt ?? signal.createdAt);
}

/** Unités de montant : jamais des entités à part entière. */
const UNITS = new Set([
  "m€",
  "m$",
  "meur",
  "md€",
  "k€",
  "millions",
  "million",
  "milliards",
  "milliard",
]);

const TITLE_STOP = new Set([
  "le",
  "la",
  "les",
  "un",
  "une",
  "des",
  "du",
  "de",
  "et",
  "ou",
  "en",
  "au",
  "aux",
  "pour",
  "par",
  "sur",
  "avec",
  "sans",
  "dans",
  "son",
  "sa",
  "ses",
  "ce",
  "cette",
  "ces",
  "qui",
  "que",
  "the",
  "and",
  "for",
  "with",
  "its",
  "new",
  "nouveau",
  "nouvelle",
  "nouveaux",
  "nouvelles",
]);

/** Montant lisible (« 5 M€ », « 5 millions d'euros », « 12 M$ ») ramené à une clé « 5m ». */
const AMOUNT = /(\d+(?:[.,]\d+)?)\s*(?:m€|m\$|meur|millions?|milliards?|md€|k€|%)/gi;

/**
 * Entités d'un titre : noms propres (mots capitalisés hors début de titre), sigles et montants,
 * sans les noms de l'entreprise suivie. Ce sont les marqueurs d'un même événement (« Openchip »,
 * « 5 M€ ») que la ressemblance des mots ne capte pas quand deux médias titrent différemment.
 */
export function titleEntities(title: string, exclude: string[] = []): Set<string> {
  const out = new Set<string>();
  const excluded = new Set(exclude.flatMap((n) => normalize(n).split(" ")));
  const words = title.split(/[^\p{L}\p{N}€$%.,-]+/u).filter(Boolean);
  words.forEach((w, i) => {
    const clean = w.replace(/^[.,-]+|[.,-]+$/g, "");
    if (clean.length < 2) return;
    const key = normalize(clean);
    if (!key || TITLE_STOP.has(key) || UNITS.has(key) || excluded.has(key)) return;
    const acronym = /^[A-Z0-9][A-Z0-9-]+$/.test(clean) && /[A-Z]/.test(clean);
    const capitalized = /^\p{Lu}/u.test(clean) && i > 0;
    if (acronym || capitalized) out.add(key);
  });
  for (const m of title.matchAll(AMOUNT)) out.add(`${m[1]!.replace(",", ".")}m`);
  return out;
}

/**
 * Affinité de deux titres pour un même événement : ressemblance des mots, plus 0,3 par entité
 * commune (partenaire, sigle, montant), plus 0,1 si les catégories coïncident, moins 0,2 si les
 * deux titres portent des montants différents et moins 0,1 s'ils nomment des partenaires différents.
 */
export function titleAffinity(
  a: string,
  b: string,
  opts: { exclude?: string[]; sameCategory?: boolean } = {},
): number {
  const ea = titleEntities(a, opts.exclude);
  const eb = titleEntities(b, opts.exclude);
  const isAmount = (e: string) => /^\d/.test(e);
  const split = (set: Set<string>) => ({
    amounts: [...set].filter(isAmount),
    names: [...set].filter((e) => !isAmount(e)),
  });
  const sa = split(ea);
  const sb = split(eb);
  const sharedAmounts = sa.amounts.filter((e) => eb.has(e)).length;
  const sharedNames = sa.names.filter((e) => eb.has(e)).length;
  let affinity = textSimilarity(a, b) + 0.3 * (sharedAmounts + sharedNames);
  if (opts.sameCategory) affinity += 0.1;
  // Deux montants connus et différents (85 M€ contre 100 M€), ou deux partenaires connus et
  // différents : vraisemblablement deux événements, même si les mots se ressemblent.
  if (sa.amounts.length && sb.amounts.length && !sharedAmounts) affinity -= 0.2;
  if (sa.names.length && sb.names.length && !sharedNames) affinity -= 0.1;
  return Math.max(0, Math.min(1, affinity));
}

/**
 * Regroupement d'un même événement : même entreprise, dans une fenêtre de 7 jours autour de la
 * date de l'événement (sinon de la publication la plus ancienne), titres proches ou marqueurs
 * communs. Une reprise quasi identique d'un communiqué est toujours regroupée. Une catégorie
 * différente n'interdit pas le regroupement, elle le rend seulement plus exigeant.
 */
export function decideCluster(
  obs: Pick<Observation, "companyId" | "title" | "excerpt" | "collectedAt" | "publishedAt">,
  category: Category,
  candidates: ClusterCandidate[],
  companyNames: string[] = [],
): ClusterDecision {
  if (!obs.companyId) return { kind: "new" };
  const obsTime = Date.parse(obs.publishedAt ?? obs.collectedAt);
  let best: { id: string; sim: number } | null = null;
  for (const { signal, observations } of candidates) {
    if (signal.companyId !== obs.companyId) continue;
    if (Math.abs(obsTime - clusterReference(signal)) > CLUSTER_WINDOW_DAYS * DAY) continue;
    const copy = observations.some(
      (o) => textSimilarity(o.excerpt, obs.excerpt) >= SYNDICATION_THRESHOLD,
    );
    if (copy) return { kind: "attach", signalId: signal.id, similarity: 1 };
    const opts = { exclude: companyNames, sameCategory: signal.category === category };
    const sim = Math.max(
      titleAffinity(signal.title, obs.title, opts),
      ...observations.map((o) => titleAffinity(o.title, obs.title, opts)),
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
