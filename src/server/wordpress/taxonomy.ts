import type { WordPressCategory, WordPressSettings } from "@/lib/api/types";
import type { WordPressClient } from "../adapters/channels";
import { slugify } from "../domain/text";
import { CATEGORY_LABEL } from "../store/catalog";
import { textKey } from "./html";

/** Libellés des catégories KORA proposés à la correspondance. */
export const KORA_CATEGORIES: string[] = Object.values(CATEGORY_LABEL);

/** Slugs WordPress : les caractères non ASCII sont encodés (`%c3%a9`), en minuscules. */
function slugKey(slug: string): string {
  try {
    return decodeURIComponent(slug).normalize("NFC").toLowerCase();
  } catch {
    return slug.toLowerCase();
  }
}

export interface CategoryResolution {
  ids: number[];
  /** `defaultCategory` appliquée faute de correspondance. */
  defaultSlug: string | null;
  /** Aucune catégorie retenue : WordPress garde (ou applique) la sienne. */
  none: boolean;
  /** Slugs configurés absents du site, ignorés. */
  unknownSlugs: string[];
}

/**
 * Catégories de la version → identifiants du site : correspondance configurée (libellé insensible
 * à la casse), sinon catégorie WordPress de même nom ou de même slug ; à défaut `defaultCategory`.
 */
export function resolveCategories(
  labels: string[],
  settings: WordPressSettings,
  available: WordPressCategory[],
): CategoryResolution {
  const bySlug = new Map(available.map((c) => [slugKey(c.slug), c]));
  const mapped = new Map(
    Object.entries(settings.categoryMap).map(([label, slug]) => [textKey(label), slug]),
  );
  const ids = new Set<number>();
  const unknownSlugs = new Set<string>();
  for (const label of labels) {
    const slug = mapped.get(textKey(label));
    const configured = slug ? bySlug.get(slugKey(slug)) : undefined;
    if (slug && !configured) unknownSlugs.add(slug);
    const match =
      configured ??
      available.find((c) => textKey(c.name) === textKey(label)) ??
      bySlug.get(slugKey(slugify(label)));
    if (match) ids.add(match.id);
  }
  let defaultSlug: string | null = null;
  if (!ids.size && settings.defaultCategory) {
    const fallback = bySlug.get(slugKey(settings.defaultCategory));
    if (fallback) {
      ids.add(fallback.id);
      defaultSlug = settings.defaultCategory;
    } else unknownSlugs.add(settings.defaultCategory);
  }
  return { ids: [...ids], defaultSlug, none: !ids.size, unknownSlugs: [...unknownSlugs] };
}

export interface Taxonomy {
  categories: number[];
  tags: number[];
  /** Phrases ajoutées au message de la tentative. */
  notes: string[];
}

/** Catégories et étiquettes existantes du site pour une version ; jamais d'échec bloquant pour elles. */
export async function resolveTaxonomy(
  client: WordPressClient,
  version: { categories: string[]; tags: string[] },
  settings: WordPressSettings,
  update: boolean,
): Promise<Taxonomy> {
  const categories = resolveCategories(version.categories, settings, await client.listCategories());
  const tags = version.tags.length ? await client.findTags(version.tags) : { ids: [], missing: [] };
  const notes: string[] = [];
  if (categories.unknownSlugs.length) {
    notes.push(
      `Catégorie(s) configurée(s) introuvable(s) sur le site, ignorée(s) : ${categories.unknownSlugs.join(", ")}.`,
    );
  }
  if (categories.defaultSlug) {
    notes.push(`Catégorie par défaut appliquée (${categories.defaultSlug}).`);
  } else if (categories.none) {
    notes.push(
      update
        ? "Aucune catégorie correspondante : les catégories du brouillon sont conservées."
        : "Aucune catégorie correspondante : WordPress appliquera sa catégorie par défaut.",
    );
  }
  if (tags.missing.length) {
    notes.push(
      `Étiquette(s) absente(s) de WordPress, ignorée(s) (le compte KORA ne peut pas en créer) : ${tags.missing.join(", ")}.`,
    );
  }
  return { categories: categories.ids, tags: tags.ids, notes };
}
