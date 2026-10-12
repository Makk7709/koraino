import type { LinkedInPost, LinkedInVariant } from "@/lib/api/types";

export const LINKEDIN_MAX_CHARS = 3000;

export function hashtag(h: string): string {
  return h.startsWith("#") ? h : `#${h}`;
}

export function selectedVariant(post: LinkedInPost): LinkedInVariant | undefined {
  return post.variants.find((v) => v.id === post.selectedVariantId) ?? post.variants[0];
}

/** Texte final tel qu'exporté / copié : corps + hashtags. */
export function fullText(text: string, hashtags: string[]): string {
  const tags = hashtags.map(hashtag).join(" ");
  return tags ? `${text.trimEnd()}\n\n${tags}` : text;
}

export function variantLetter(index: number): string {
  return String.fromCharCode(65 + index);
}

export function postExcerpt(post: LinkedInPost): string {
  return selectedVariant(post)?.text.replace(/\s+/g, " ").trim() ?? "";
}
