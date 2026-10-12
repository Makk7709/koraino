import { useCallback, useState } from "react";
import type { ArticleDetail, ArticleVersion } from "@/lib/api/types";

export interface ArticleDraft {
  title: string;
  chapo: string;
  body: string;
  excerpt: string;
  seoTitle: string;
  categories: string[];
  tags: string[];
}

export function currentVersionOf(article: ArticleDetail): ArticleVersion | undefined {
  return (
    article.versions.find((v) => v.n === article.currentVersion) ??
    [...article.versions].sort((a, b) => b.n - a.n)[0]
  );
}

export function toDraft(v: ArticleVersion | undefined): ArticleDraft {
  return {
    title: v?.title ?? "",
    chapo: v?.chapo ?? "",
    body: v?.body ?? "",
    excerpt: v?.excerpt ?? "",
    seoTitle: v?.seoTitle ?? "",
    categories: [...(v?.categories ?? [])],
    tags: [...(v?.tags ?? [])],
  };
}

const sameList = (a: string[], b: string[]) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

export function sameDraft(a: ArticleDraft, b: ArticleDraft): boolean {
  return (
    a.title === b.title &&
    a.chapo === b.chapo &&
    a.body === b.body &&
    a.excerpt === b.excerpt &&
    a.seoTitle === b.seoTitle &&
    sameList(a.categories, b.categories) &&
    sameList(a.tags, b.tags)
  );
}

/**
 * Brouillon local de la version courante. Il repart de la version serveur dès que
 * celle-ci change (enregistrement, restauration) ; `dirty` signale des modifications
 * non enregistrées, qui interdisent approbation et diffusion.
 */
export function useArticleDraft(article: ArticleDetail) {
  const base = currentVersionOf(article);
  const key = `${article.id}:${article.currentVersion}`;
  const [state, setState] = useState(() => ({ key, draft: toDraft(base) }));
  let draft = state.draft;
  if (state.key !== key) {
    draft = toDraft(base);
    setState({ key, draft });
  }
  const update = useCallback(<K extends keyof ArticleDraft>(field: K, value: ArticleDraft[K]) => {
    setState((s) => ({ ...s, draft: { ...s.draft, [field]: value } }));
  }, []);
  const reset = () => setState({ key, draft: toDraft(base) });
  return { draft, base, dirty: !sameDraft(draft, toDraft(base)), update, reset };
}

export type ArticleDraftState = ReturnType<typeof useArticleDraft>;
