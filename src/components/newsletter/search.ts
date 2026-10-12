import { searchString } from "@/components/articles/search";

export interface NewsletterSearch {
  /** Édition sélectionnée. */
  id?: string | undefined;
}

export function parseNewsletterSearch(s: Record<string, unknown>): NewsletterSearch {
  return { id: searchString(s["id"]) };
}
