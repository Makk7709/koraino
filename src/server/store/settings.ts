import type { WordPressSettings } from "@/lib/api/types";
import type { Settings } from "./records";

/**
 * Réglages WordPress lus avec tolérance : absents (réglages enregistrés avant l'intégration) ou
 * mal formés, ils valent `{ categoryMap: {}, defaultCategory: null }`.
 */
export function wordpressSettingsOf(settings: Pick<Settings, "wordpress"> | null | undefined) {
  const raw: unknown = settings?.wordpress;
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

/** Réglages tels que lus en base ou en mémoire, complétés des champs ajoutés depuis. */
export function normalizeSettings(settings: Settings): Settings {
  return { ...settings, wordpress: wordpressSettingsOf(settings) };
}
