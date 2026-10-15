import type { Tone } from "@/components/kora/labels";
import type { WordPressCategory, WordPressCheck, WordPressSettings } from "@/lib/api/types";

/** Valeur « — aucune — » des listes déroulantes (Radix refuse une valeur vide). */
export const NO_CATEGORY = "__aucune__";

export const WORDPRESS_VARIABLES = [
  {
    name: "WORDPRESS_URL",
    hint: "Adresse du site, en https:// et sans chemin (ni /wp-admin, ni /wp-json).",
  },
  { name: "WORDPRESS_USERNAME", hint: "Identifiant du compte dédié créé à l'étape 1." },
  {
    name: "WORDPRESS_APP_PASSWORD",
    hint: "Mot de passe d'application généré à l'étape 2 (les espaces sont acceptés).",
  },
] as const;

/** Variables à afficher dans la procédure : les trois attendues, plus toute autre signalée. */
export function setupVariables(
  missing: string[],
): { name: string; hint: string; missing: boolean }[] {
  const known = WORDPRESS_VARIABLES.map((v) => ({
    name: v.name as string,
    hint: v.hint as string,
    missing: missing.includes(v.name),
  }));
  const extra = missing
    .filter((m) => !known.some((k) => k.name === m))
    .map((name) => ({ name, hint: "", missing: true }));
  return [...known, ...extra];
}

const WP_ROLE: Record<string, string> = {
  administrator: "Administrateur",
  editor: "Éditeur",
  author: "Auteur",
  contributor: "Contributeur",
  subscriber: "Abonné",
};

export function wordpressRoleLabel(role: string): string {
  return WP_ROLE[role] ?? role;
}

export interface CheckVerdict {
  tone: Tone;
  title: string;
  detail: string | null;
}

/** Lecture du test de connexion : un compte qui peut publier est signalé (Contributeur attendu). */
export function checkVerdict(check: WordPressCheck): CheckVerdict {
  if (!check.ok)
    return {
      tone: "rose",
      title: "Connexion impossible",
      detail: check.error?.message ?? "Le site WordPress n'a pas répondu comme prévu.",
    };
  if (check.canPublish)
    return {
      tone: "amber",
      title: "Connexion réussie, mais le rôle du compte est trop élevé",
      detail:
        "Ce compte peut publier lui-même sur le site. Pour le pilote, donnez-lui le rôle Contributeur : KORA ne doit pouvoir créer que des brouillons.",
    };
  if (check.canPublish === null)
    return {
      tone: "blue",
      title: "Connexion réussie",
      detail:
        "Les droits de publication du compte n'ont pas pu être vérifiés : assurez-vous qu'il a le rôle Contributeur.",
    };
  return {
    tone: "green",
    title: "Connexion réussie",
    detail: "Le compte ne peut pas publier : KORA ne créera que des brouillons.",
  };
}

/** Slug lisible (WordPress encode les caractères accentués en `%xx`). */
export function decodeSlug(slug: string): string {
  try {
    return decodeURIComponent(slug);
  } catch {
    return slug;
  }
}

export interface CategoryOption {
  slug: string;
  name: string;
  depth: number;
  /** Chemin complet (« Actualités › Levées de fonds »), pour distinguer les homonymes. */
  path: string;
}

/**
 * Catégories WordPress en ordre hiérarchique : chaque parent suivi de ses enfants, par ordre
 * alphabétique. Un parent introuvable rattache la catégorie à la racine ; un cycle est rompu.
 */
export function categoryOptions(categories: WordPressCategory[]): CategoryOption[] {
  const ids = new Set(categories.map((c) => c.id));
  const children = new Map<number, WordPressCategory[]>();
  for (const c of categories) {
    const parent = c.parent !== c.id && ids.has(c.parent) ? c.parent : 0;
    const list = children.get(parent) ?? [];
    list.push(c);
    children.set(parent, list);
  }
  const collator = new Intl.Collator("fr", { sensitivity: "base", numeric: true });
  const byName = (a: WordPressCategory, b: WordPressCategory) => collator.compare(a.name, b.name);
  const out: CategoryOption[] = [];
  const seen = new Set<number>();
  const walk = (c: WordPressCategory, depth: number, trail: string[]) => {
    if (seen.has(c.id)) return;
    seen.add(c.id);
    const path = [...trail, c.name];
    out.push({ slug: c.slug, name: c.name, depth, path: path.join(" › ") });
    for (const child of [...(children.get(c.id) ?? [])].sort(byName)) walk(child, depth + 1, path);
  };
  for (const root of [...(children.get(0) ?? [])].sort(byName)) walk(root, 0, []);
  for (const rest of [...categories].sort(byName)) walk(rest, 0, []);
  return out;
}

/** Correspondance éditable : une entrée par catégorie KORA (clés comparées sans la casse). */
export function initialMapping(
  koraCategories: string[],
  categoryMap: Record<string, string>,
): Record<string, string> {
  const lower = new Map(
    Object.entries(categoryMap).map(([k, v]) => [k.toLocaleLowerCase("fr"), v] as const),
  );
  return Object.fromEntries(
    koraCategories.map((label) => [
      label,
      categoryMap[label] ?? lower.get(label.toLocaleLowerCase("fr")) ?? NO_CATEGORY,
    ]),
  );
}

/**
 * Corps de PUT /wordpress/settings : seules les catégories KORA proposées par le serveur
 * (il refuse toute autre clé), sans les choix « — aucune — ».
 */
export function buildWordPressSettings(
  koraCategories: string[],
  mapping: Record<string, string>,
  defaultCategory: string,
): WordPressSettings {
  const categoryMap: Record<string, string> = {};
  for (const label of koraCategories) {
    const slug = mapping[label];
    if (slug && slug !== NO_CATEGORY) categoryMap[label] = slug;
  }
  return {
    categoryMap,
    defaultCategory: defaultCategory && defaultCategory !== NO_CATEGORY ? defaultCategory : null,
  };
}

export function sameSettings(a: WordPressSettings, b: WordPressSettings): boolean {
  const keys = new Set([...Object.keys(a.categoryMap), ...Object.keys(b.categoryMap)]);
  for (const k of keys) if (a.categoryMap[k] !== b.categoryMap[k]) return false;
  return (a.defaultCategory ?? null) === (b.defaultCategory ?? null);
}
