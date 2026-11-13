/**
 * Tarifs publics des fournisseurs payants, relevés le 13 novembre 2026 : le budget API compte le
 * coût mesuré à chaque appel, pas un forfait.
 *
 * - OpenAI : <https://platform.openai.com/docs/models/gpt-4o-mini> (prix par million de jetons).
 * - Perplexity Search : <https://docs.perplexity.ai/getting-started/pricing> (prix par requête
 *   réussie, même sans résultat ; une requête refusée ou en échec n'est pas facturée).
 *
 * Les flux RSS et Google News sont gratuits : ils ne coûtent rien au budget.
 */

/**
 * Les fournisseurs facturent en dollars, le budget est tenu en euros hors taxes. La conversion se
 * fait à parité : tant que le dollar vaut moins qu'un euro, le compteur majore un peu la dépense
 * et ne la sous-estime pas.
 */
export const EUR_PER_USD = 1;

/** Prix OpenAI en dollars par million de jetons. */
export const OPENAI_USD_PER_MILLION_TOKENS = {
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
} as const;

export type OpenAiModel = keyof typeof OPENAI_USD_PER_MILLION_TOKENS;

/** Modèle appelé : changer de modèle impose d'en renseigner le prix ci-dessus. */
export const OPENAI_MODEL: OpenAiModel = "gpt-4o-mini";

/**
 * Bornes de chaque appel au modèle : réponse la plus longue admise (`max_tokens` de la requête)
 * et texte soumis le plus long couvert par la réservation.
 */
export const OPENAI_CALLS = {
  article: { maxInputTokens: 50_000, maxOutputTokens: 2_500 },
  linkedin: { maxInputTokens: 8_000, maxOutputTokens: 900 },
  summary: { maxInputTokens: 5_000, maxOutputTokens: 220 },
  classification: { maxInputTokens: 2_500, maxOutputTokens: 160 },
} as const;

export type OpenAiCall = keyof typeof OPENAI_CALLS;

/** Coût d'un appel OpenAI d'après les jetons facturés (les jetons en cache comptent plein tarif). */
export function openAiCostEur(
  model: OpenAiModel,
  inputTokens: number,
  outputTokens: number,
): number {
  const price = OPENAI_USD_PER_MILLION_TOKENS[model];
  return ((inputTokens * price.input + outputTokens * price.output) / 1e6) * EUR_PER_USD;
}

/** Coût maximal estimé d'un appel au modèle : texte soumis et réponse les plus longs. */
export function openAiMaxCostEur(call: OpenAiCall): number {
  const { maxInputTokens, maxOutputTokens } = OPENAI_CALLS[call];
  return openAiCostEur(OPENAI_MODEL, maxInputTokens, maxOutputTokens);
}

/** Une requête Perplexity Search réussie : 5 $ les 1 000. */
export const PERPLEXITY_SEARCH_EUR = (5 / 1000) * EUR_PER_USD;

const MICRO = 1e6;

/** Arrondi au millionième d'euro : un appel au modèle coûte quelques dix-millièmes d'euro. */
export function roundEur(value: number): number {
  return Math.round(value * MICRO) / MICRO;
}

/**
 * Compteur du coût mesuré pendant un appel payant. Les adaptateurs y ajoutent ce que chaque
 * requête a réellement coûté ; un compteur enfant reporte aussi sur son parent (une source dans
 * un lot de collecte).
 */
export class ApiMeter {
  private micro = 0;

  constructor(private readonly parent?: ApiMeter) {}

  add(costEur: number): void {
    if (!(costEur > 0)) return;
    this.micro += Math.round(costEur * MICRO);
    this.parent?.add(costEur);
  }

  get costEur(): number {
    return this.micro / MICRO;
  }

  child(): ApiMeter {
    return new ApiMeter(this);
  }
}
