import type { Article } from "@/lib/api/types";

export const ARTICLE_TABS = [
  "tous",
  "brouillons",
  "en_revue",
  "prets",
  "publies",
  "rejetes",
  "imports",
] as const;
export type ArticlesTab = (typeof ARTICLE_TABS)[number];

export interface ArticlesSearch {
  /** Article sélectionné. */
  id?: string | undefined;
  /** Filtre de statut de la liste, ou « imports » (Human Content Guard). */
  tab?: ArticlesTab | undefined;
  /** Import humain sélectionné (onglet « imports »). */
  importId?: string | undefined;
}

/** Valeur de search param en chaîne (le parseur par défaut peut produire un nombre). */
export function searchString(v: unknown): string | undefined {
  if (typeof v === "number") return String(v);
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

export function parseArticlesSearch(s: Record<string, unknown>): ArticlesSearch {
  const tab = s["tab"];
  return {
    id: searchString(s["id"]),
    tab: ARTICLE_TABS.find((t) => t === tab),
    importId: searchString(s["importId"]),
  };
}

export const ARTICLE_TAB_LABEL: Record<ArticlesTab, string> = {
  tous: "Tous",
  brouillons: "Brouillons",
  en_revue: "En revue",
  prets: "Prêts à publier",
  publies: "Publiés",
  rejetes: "Rejetés",
  imports: "Imports humains",
};

export function matchesTab(a: Article, tab: ArticlesTab): boolean {
  switch (tab) {
    case "brouillons":
      return a.status === "brouillon";
    case "en_revue":
      return a.status === "en_revue";
    case "prets":
      return a.status === "approuve" || a.status === "programme";
    case "publies":
      return a.status === "publie";
    case "rejetes":
      return a.status === "rejete";
    default:
      return true;
  }
}
