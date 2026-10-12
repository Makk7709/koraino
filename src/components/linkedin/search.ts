import type { LinkedInPost } from "@/lib/api/types";
import { searchString } from "@/components/articles/search";

export const LINKEDIN_TABS = ["a_valider", "brouillons", "approuves", "diffuses", "tous"] as const;
export type LinkedInTab = (typeof LINKEDIN_TABS)[number];

export interface LinkedInSearch {
  /** Post sélectionné. */
  id?: string | undefined;
  tab?: LinkedInTab | undefined;
}

export function parseLinkedInSearch(s: Record<string, unknown>): LinkedInSearch {
  const tab = s["tab"];
  return { id: searchString(s["id"]), tab: LINKEDIN_TABS.find((t) => t === tab) };
}

export const LINKEDIN_TAB_LABEL: Record<LinkedInTab, string> = {
  a_valider: "À valider",
  brouillons: "Brouillons",
  approuves: "Approuvés",
  diffuses: "Exportés / publiés",
  tous: "Tous",
};

export function matchesLinkedInTab(p: LinkedInPost, tab: LinkedInTab): boolean {
  switch (tab) {
    case "a_valider":
      return p.status === "a_valider";
    case "brouillons":
      return p.status === "brouillon";
    case "approuves":
      return p.status === "approuve";
    case "diffuses":
      return p.status === "exporte" || p.status === "publie";
    default:
      return true;
  }
}
