import type { WordPressSettings } from "@/lib/api/types";

/**
 * Enregistrement dédié à la correspondance des catégories WordPress (ligne de `kora_records` en
 * base), hors des réglages partagés que réécrivent le budget et les alertes.
 */
export const WORDPRESS_SETTINGS = { collection: "config", id: "wordpress" } as const;

/**
 * Correspondance des catégories WordPress lue avec tolérance : absente (jamais enregistrée) ou mal
 * formée, elle vaut `{ categoryMap: {}, defaultCategory: null }`.
 */
export function wordpressSettingsOf(raw: unknown): WordPressSettings {
  const out: WordPressSettings = { categoryMap: {}, defaultCategory: null };
  if (!raw || typeof raw !== "object") return out;
  const { categoryMap, defaultCategory } = raw as Record<string, unknown>;
  if (categoryMap && typeof categoryMap === "object" && !Array.isArray(categoryMap)) {
    for (const [label, slug] of Object.entries(categoryMap)) {
      if (typeof slug === "string" && slug) out.categoryMap[label] = slug;
    }
  }
  if (typeof defaultCategory === "string" && defaultCategory) out.defaultCategory = defaultCategory;
  return out;
}
