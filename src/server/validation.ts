import { z } from "zod";
import { badRequest } from "./http";

export const THEMES = [
  "deeptech_quantique",
  "ia_industrie",
  "transition_energetique",
  "talents_rh",
  "sante_biotech",
  "mobilite",
  "numerique",
] as const;
export const CATEGORIES = [
  "financement",
  "acquisition",
  "contrat",
  "partenariat",
  "innovation",
  "produit",
  "brevet",
  "recrutement",
  "croissance",
  "international",
  "distinction",
  "recherche",
] as const;
export const SIGNAL_STATUSES = [
  "nouveau",
  "a_traiter",
  "en_revue",
  "surveille",
  "traite",
  "rejete",
] as const;
export const CHANNELS = ["wordpress", "linkedin", "newsletter"] as const;
export const SOURCE_TYPES = [
  "site_officiel",
  "actualites",
  "communiques",
  "rss",
  "recherche_web",
  "newsletter_import",
] as const;
export const RULE_KINDS = ["ton", "longueur", "structure", "vocabulaire", "interdit"] as const;

const text = (max: number) => z.string().trim().min(1).max(max);
const isoDate = z.string().refine((s) => !Number.isNaN(Date.parse(s)), "Date ISO 8601 attendue");

export const schemas = {
  switchUser: z.object({ userId: text(64) }),
  company: z.object({
    name: z.string().trim().min(2).max(120),
    aliases: z.array(text(120)).max(20).optional(),
    domain: z.string().trim().min(3).max(253),
    sector: z.string().trim().min(2).max(120),
    territory: z.string().trim().max(120).optional(),
    priority: z.enum(["haute", "normale", "basse"]).optional(),
    themes: z.array(z.enum(THEMES)).max(7).optional(),
  }),
  source: z.object({
    companyId: text(64),
    type: z.enum(SOURCE_TYPES),
    label: text(120),
    url: text(2048),
    frequency: z.enum(["quotidienne", "hebdomadaire"]).optional(),
  }),
  sourcePatch: z.object({
    companyId: text(64).optional(),
    type: z.enum(SOURCE_TYPES).optional(),
    label: text(120).optional(),
    url: text(2048).optional(),
    frequency: z.enum(["quotidienne", "hebdomadaire"]).optional(),
    access: z.enum(["ok", "erreur", "en_attente", "desactivee"]).optional(),
  }),
  signalPatch: z.object({
    status: z.enum(SIGNAL_STATUSES).optional(),
    statusReason: z.string().trim().max(500).nullable().optional(),
    companyId: z.string().trim().max(64).nullable().optional(),
    inNewsletter: z.boolean().optional(),
  }),
  merge: z.object({ otherIds: z.array(text(64)).min(1).max(50) }),
  split: z.object({ observationIds: z.array(text(64)).min(1).max(200) }),
  grid: z.object({
    weights: z.object({
      importance: z.number(),
      nouveaute: z.number(),
      territoire: z.number(),
      lecteurs: z.number(),
      diffusion: z.number(),
    }),
    note: z.string().trim().max(500).nullable().optional(),
  }),
  createArticle: z.object({
    signalId: text(64),
    angle: z.string().trim().max(200).nullable().optional(),
  }),
  articleVersion: z.object({
    title: text(300),
    chapo: z.string().max(2000),
    body: z.string().max(100_000),
    excerpt: z.string().max(1000).optional(),
    seoTitle: z.string().max(200).optional(),
    categories: z.array(text(80)).max(20).optional(),
    tags: z.array(text(80)).max(30).optional(),
    note: z.string().max(500).nullable().optional(),
  }),
  restore: z.object({ version: z.number().int().min(1) }),
  approve: z.object({
    channel: z.enum(CHANNELS),
    version: z.number().int().min(1),
    scheduledAt: isoDate.nullable().optional(),
  }),
  reject: z.object({
    reason: z.string().trim().min(3, "Le motif de rejet est obligatoire").max(1000),
  }),
  publish: z.object({ channel: z.enum(CHANNELS) }),
  factCheck: z.object({
    status: z.enum(["etaye", "non_corrobore"]),
    note: z.string().trim().max(1000).nullable().optional(),
  }),
  proposalDecision: z.object({ decision: z.enum(["en_attente", "acceptee", "refusee"]) }),
  createLinkedIn: z
    .object({ articleId: text(64).optional(), signalId: text(64).optional() })
    .refine((v) => !!v.articleId || !!v.signalId, "articleId ou signalId est requis"),
  updateLinkedIn: z.object({
    selectedVariantId: text(64).optional(),
    variants: z
      .array(
        z.object({
          id: text(64),
          text: z.string().trim().min(1).max(3000),
          hashtags: z.array(text(60)).max(15),
        }),
      )
      .min(1)
      .max(4)
      .optional(),
  }),
  versionOnly: z.object({ version: z.number().int().min(1) }),
  createNewsletter: z.object({
    title: z.string().trim().min(1).max(200).optional(),
    weekOf: isoDate.optional(),
  }),
  updateNewsletter: z.object({
    title: z.string().trim().min(1).max(200).optional(),
    intro: z.string().trim().max(3000).optional(),
    items: z
      .array(
        z.object({
          id: text(64),
          summary: z.string().trim().min(1).max(1500),
          order: z.number().int().min(0),
        }),
      )
      .max(100)
      .optional(),
  }),
  newsletterItem: z
    .object({ signalId: text(64).optional(), articleId: text(64).optional() })
    .refine((v) => !!v.signalId || !!v.articleId, "signalId ou articleId est requis"),
  createRule: z.object({ kind: z.enum(RULE_KINDS), text: text(500) }),
  updateRule: z.object({ text: text(500).optional(), active: z.boolean().optional() }),
  ruleDecision: z.object({ decision: z.enum(["acceptee", "refusee"]) }),
};

/** Valide un corps de requête ; 400 `validation_error` avec le détail des champs sinon. */
export function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input ?? {});
  if (result.success) return result.data;
  const issues = result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
  const first = issues[0];
  throw badRequest(
    "validation_error",
    first
      ? `Requête invalide : ${first.path ? `${first.path} — ` : ""}${first.message}`
      : "Requête invalide",
    { issues },
  );
}

/** Retire les clés `undefined` (compatibilité exactOptionalPropertyTypes). */
export function defined<T extends object>(obj: T): { [K in keyof T]: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as {
    [K in keyof T]: Exclude<T[K], undefined>;
  };
}
