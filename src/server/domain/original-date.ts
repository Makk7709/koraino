/**
 * Date originale lue sur une page d'éditeur.
 *
 * Seul l'article principal compte : `NewsArticle` et ses variantes priment sur un
 * `VideoObject` lié (vidéo embarquée, bloc `@graph`). Les dates de ces objets liés
 * ne sont pas des dates de l'article. Sur l'objet retenu, `datePublished`,
 * `article:published_time` et, pour une vidéo sans autre type d'article, `uploadDate`
 * doivent désigner le même instant. Deux valeurs lisibles différentes : la date
 * n'est pas vérifiable. `dateModified` et `article:modified_time` sont ignorés.
 */

const ARTICLE_TYPES = new Set([
  "Article",
  "NewsArticle",
  "BlogPosting",
  "LiveBlogPosting",
  "DiscussionForumPosting",
  "SocialMediaPosting",
  "Report",
  "TechArticle",
  "ScholarlyArticle",
  "ReportageNewsArticle",
  "AnalysisNewsArticle",
  "OpinionNewsArticle",
  "ReviewNewsArticle",
  "AdvertiserContentArticle",
  "SatiricalArticle",
]);

/** Instant ISO de la publication originale, ou `null` si elle n'est pas vérifiable. */
export function readOriginalPublishedAt(html: string): string | null {
  const primaries = primaryPublications(html);
  const articles = primaries.filter(isArticle);
  const mains = articles.length > 0 ? articles : primaries.filter(isVideo);
  const instants = new Set<string>();
  for (const node of mains) {
    for (const instant of ownInstants(node)) instants.add(instant);
  }
  const meta = metaPublishedTime(html);
  if (meta) instants.add(meta);
  if (instants.size !== 1) return null;
  return [...instants][0] ?? null;
}

function primaryPublications(html: string): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  const blocks =
    html.matchAll(
      /<script\b[^>]*\btype\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
    ) ?? [];
  for (const match of blocks) {
    const raw = match[1]?.trim();
    if (!raw) continue;
    try {
      walk(JSON.parse(raw) as unknown, false, found, new Set());
    } catch {
      // Bloc illisible : les autres blocs restent examinés. Aucune date n'est inventée.
    }
  }
  return found;
}

function walk(
  node: unknown,
  insidePublication: boolean,
  found: Record<string, unknown>[],
  seen: Set<unknown>,
): void {
  if (!node || typeof node !== "object") return;
  if (seen.has(node)) return;
  seen.add(node);
  if (Array.isArray(node)) {
    for (const item of node) walk(item, insidePublication, found, seen);
    return;
  }
  const rec = node as Record<string, unknown>;
  const publication = isArticle(rec) || isVideo(rec);
  if (publication && !insidePublication) found.push(rec);
  for (const [key, value] of Object.entries(rec)) {
    if (key === "@type" || key === "@context") continue;
    walk(value, insidePublication || publication, found, seen);
  }
}

function ownInstants(node: Record<string, unknown>): string[] {
  const published =
    typeof node["datePublished"] === "string" ? parseInstant(node["datePublished"]) : null;
  const upload = typeof node["uploadDate"] === "string" ? parseInstant(node["uploadDate"]) : null;
  const instants: string[] = [];
  if (published) instants.push(published);
  if (isVideo(node) && !isArticle(node) && upload && upload !== published) instants.push(upload);
  return instants;
}

function typeNames(node: Record<string, unknown>): string[] {
  const raw = node["@type"];
  const list = typeof raw === "string" ? [raw] : Array.isArray(raw) ? raw : [];
  return list
    .filter((t): t is string => typeof t === "string")
    .map((t) => t.split(/[#/]/).pop() ?? t);
}

function isArticle(node: Record<string, unknown>): boolean {
  return typeNames(node).some((t) => ARTICLE_TYPES.has(t));
}

function isVideo(node: Record<string, unknown>): boolean {
  return typeNames(node).includes("VideoObject");
}

function metaPublishedTime(html: string): string | null {
  const tags = html.matchAll(/<meta\b([^>]*)>/gi) ?? [];
  for (const match of tags) {
    const attrs = match[1] ?? "";
    if (!/\b(?:property|name)\s*=\s*["']article:published_time["']/i.test(attrs)) continue;
    const content = /\bcontent\s*=\s*["']([^"']*)["']/i.exec(attrs)?.[1];
    const instant = content ? parseInstant(content) : null;
    if (instant) return instant;
  }
  return null;
}

function parseInstant(value: string): string | null {
  const t = Date.parse(value.trim());
  if (Number.isNaN(t)) return null;
  return new Date(t).toISOString();
}
