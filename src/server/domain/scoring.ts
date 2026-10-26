import type {
  Category,
  ContentAssessment,
  Criterion,
  Observation,
  ScoreResult,
  ScoringGrid,
  SignalStatus,
  Theme,
} from "@/lib/api/types";
import type { CompanyRecord } from "../store/records";
import { extractAmountsM } from "./text";

export const CRITERIA: Criterion[] = [
  "importance",
  "nouveaute",
  "territoire",
  "lecteurs",
  "diffusion",
];

export const DEFAULT_WEIGHTS: Record<Criterion, number> = {
  importance: 30,
  nouveaute: 20,
  territoire: 20,
  lecteurs: 20,
  diffusion: 10,
};

export const NATIONAL_OUTLETS = new Set([
  "lesechos.fr",
  "lefigaro.fr",
  "bfmtv.com",
  "usinenouvelle.com",
  "latribune.fr",
  "ec.europa.eu",
]);

const CATEGORY_IMPORTANCE: Record<Category, number> = {
  financement: 82,
  acquisition: 82,
  contrat: 74,
  partenariat: 72,
  innovation: 72,
  produit: 66,
  brevet: 62,
  recrutement: 58,
  croissance: 70,
  international: 74,
  distinction: 66,
  recherche: 68,
};

const PRIORITY_THEMES: Theme[] = ["deeptech_quantique", "ia_industrie", "transition_energetique"];

/** Contrôle d'une grille : chaque poids entier entre 0 et 100, somme = 100. */
export function validateWeights(weights: Record<Criterion, number>): string | null {
  for (const c of CRITERIA) {
    const w = weights[c];
    if (!Number.isInteger(w) || w < 0 || w > 100) {
      return `Le poids « ${c} » doit être un entier entre 0 et 100.`;
    }
  }
  const sum = CRITERIA.reduce((acc, c) => acc + weights[c], 0);
  if (sum !== 100) return `La somme des poids doit valoir 100 % (actuellement ${sum} %).`;
  return null;
}

export function computeTotal(
  subScores: Record<Criterion, number>,
  weights: Record<Criterion, number>,
): number {
  const raw = CRITERIA.reduce((acc, c) => acc + subScores[c] * weights[c], 0) / 100;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

/** Applique une grille à des sous-notes existantes (les motifs sont conservés). */
export function applyGrid(
  score: Omit<ScoreResult, "total" | "gridVersion">,
  grid: ScoringGrid,
): ScoreResult {
  return {
    total: computeTotal(score.subScores, grid.weights),
    gridVersion: grid.version,
    subScores: { ...score.subScores },
    reasons: { ...score.reasons },
  };
}

/** Un signal décidé (traité, rejeté) conserve le score et la grille de sa décision. */
export function isDecided(status: SignalStatus): boolean {
  return status === "traite" || status === "rejete";
}

export interface AssessInput {
  category: Category;
  title: string;
  text: string;
  company: CompanyRecord | null;
  observations: Observation[];
  /** Un signal de même entreprise et même catégorie existe dans les 90 jours précédents. */
  priorSameCategory: boolean;
  /** Écart (jours) entre l'événement et sa détection ; null si la date est inconnue. */
  eventLagDays: number | null;
  /** Lecture du contenu par le modèle : son importance remplace celle déduite de la catégorie. */
  content?: ContentAssessment | null;
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

/** Sous-notes et motifs explicables, calculés à partir des seules données du signal. */
export function assess(input: AssessInput): Pick<ScoreResult, "subScores" | "reasons"> {
  const { category, company, observations } = input;
  const amounts = extractAmountsM(`${input.title} ${input.text}`);
  const maxAmount = amounts.length ? Math.max(...amounts) : 0;

  let importance = CATEGORY_IMPORTANCE[category];
  const impParts = [`catégorie « ${category} »`];
  if (input.content) {
    // Le modèle a lu la publication : son jugement remplace la grille par catégorie et le montant.
    importance = clamp(input.content.importance);
    impParts.length = 0;
    impParts.push(`lecture du contenu par le modèle : ${input.content.reason}`);
  } else if (maxAmount >= 50) {
    importance += 12;
    impParts.push(`montant élevé (${maxAmount} M€)`);
  } else if (maxAmount >= 10) {
    importance += 6;
    impParts.push(`montant significatif (${maxAmount} M€)`);
  }
  if (company?.priority === "haute") {
    importance += 5;
    impParts.push("entreprise prioritaire du registre");
  } else if (company?.priority === "basse") {
    importance -= 5;
    impParts.push("entreprise de priorité basse");
  }

  let nouveaute = input.priorSameCategory ? 55 : 86;
  const nouvParts = [
    input.priorSameCategory
      ? "un sujet de même nature existe déjà sur les 90 derniers jours"
      : "premier sujet de cette nature sur 90 jours",
  ];
  const lag = input.eventLagDays;
  if (lag === null) {
    nouveaute -= 8;
    nouvParts.push("date de l'événement inconnue");
  } else if (lag > 30) {
    nouveaute -= 25;
    nouvParts.push(`événement antérieur de ${lag} jours à sa détection`);
  } else if (lag > 14) {
    nouveaute -= 20;
    nouvParts.push(`événement antérieur de ${lag} jours à sa détection`);
  } else if (lag > 7) {
    nouveaute -= 12;
    nouvParts.push(`événement antérieur de ${lag} jours à sa détection`);
  } else if (lag > 2) {
    nouveaute -= 5;
    nouvParts.push(`événement antérieur de ${lag} jours à sa détection`);
  }

  let territoire = 30;
  let terrReason = "entreprise non rattachée : adéquation territoriale non évaluable";
  if (company) {
    const t = company.territory.toLowerCase();
    if (t.includes("inovall")) {
      territoire = 95;
      terrReason = `entreprise implantée sur Inovallée (${company.territory})`;
    } else if (
      /(grenoble|meylan|montbonnot|crolles|is[eè]re|[ée]chirolles|saint-[ée]gr[eè]ve|voiron)/.test(
        t,
      )
    ) {
      territoire = 88;
      terrReason = `entreprise de l'agglomération grenobloise (${company.territory})`;
    } else {
      territoire = 60;
      terrReason = `implantation hors bassin grenoblois (${company.territory})`;
    }
  }

  const themes = company?.themes ?? [];
  let lecteurs = 65;
  let lectReason = "thématique d'intérêt général pour le lectorat";
  const first = themes[0];
  if (first && PRIORITY_THEMES.includes(first)) {
    lecteurs = 85;
    lectReason = "thématique prioritaire de la ligne éditoriale";
  } else if (first === "talents_rh") {
    lecteurs = 80;
    lectReason = "thématique emploi et talents suivie par le lectorat";
  } else if (first) {
    lecteurs = 72;
    lectReason = "thématique suivie par le lectorat";
  }
  if (themes.length > 1) lecteurs += Math.min(10, (themes.length - 1) * 5);

  const externalOutlets = new Set(
    observations
      .filter((o) => !o.isSyndicated && (!company || o.outlet.domain !== company.domain))
      .map((o) => o.outlet.domain),
  );
  const k = externalOutlets.size;
  let diffusion = k === 0 ? 45 : k === 1 ? 60 : k === 2 ? 75 : 85;
  const national = [...externalOutlets].some((d) => NATIONAL_OUTLETS.has(d));
  if (national) diffusion += 10;
  const diffReason = `${k} média(s) indépendant(s)${national ? ", dont un média national" : ""}`;

  return {
    subScores: {
      importance: clamp(importance),
      nouveaute: clamp(nouveaute),
      territoire: clamp(territoire),
      lecteurs: clamp(lecteurs),
      diffusion: clamp(diffusion),
    },
    reasons: {
      importance: capitalize(impParts.join(", ")),
      nouveaute: capitalize(nouvParts.join(" ; ")),
      territoire: capitalize(terrReason),
      lecteurs: capitalize(lectReason),
      diffusion: capitalize(diffReason),
    },
  };
}

function capitalize(s: string): string {
  return s ? s[0]!.toUpperCase() + s.slice(1) : s;
}
