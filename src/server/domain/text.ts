const STOPWORDS = new Set([
  "le",
  "la",
  "les",
  "l",
  "de",
  "des",
  "du",
  "d",
  "un",
  "une",
  "et",
  "en",
  "pour",
  "sur",
  "avec",
  "a",
  "au",
  "aux",
  "son",
  "sa",
  "ses",
  "ce",
  "cette",
  "ces",
  "qui",
  "que",
  "dans",
  "par",
  "est",
  "se",
  "s",
  "sont",
  "ou",
  "plus",
  "leur",
  "leurs",
  "ne",
  "pas",
  "il",
  "elle",
  "the",
  "of",
  "and",
]);

export function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/** Minuscules, sans accents, ponctuation remplacée par des espaces. */
export function normalize(s: string): string {
  return stripAccents(s.toLowerCase())
    .replace(/[^a-z0-9€%]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokens(s: string): string[] {
  return normalize(s)
    .split(" ")
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

export function jaccard(a: readonly string[], b: readonly string[]): number {
  const A = new Set(a);
  const B = new Set(b);
  if (A.size === 0 && B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

export function textSimilarity(a: string, b: string): number {
  return jaccard(tokens(a), tokens(b));
}

/** La phrase normalisée `phrase` apparaît-elle comme suite de mots dans `text` ? */
export function containsPhrase(text: string, phrase: string): boolean {
  const t = ` ${normalize(text)} `;
  const p = normalize(phrase);
  return p.length > 0 && t.includes(` ${p} `);
}

export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

export function firstSentence(s: string): string {
  const m = /^(.+?[.!?…])(\s|$)/.exec(s.trim());
  return (m?.[1] ?? s).trim();
}

export function slugify(s: string): string {
  return normalize(s).replace(/[€%]/g, "").trim().replace(/\s+/g, "-").slice(0, 80);
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function wordCount(s: string): number {
  return s.split(/\s+/).filter(Boolean).length;
}

/** Montants en millions d'euros cités dans un texte (« 100 M€ », « 12 millions d'euros »). */
export function extractAmountsM(s: string): number[] {
  const out: number[] = [];
  const re = /(\d+(?:[.,]\d+)?)\s*(?:M€|M\s?€|millions?\s+d['’]euros)/gi;
  for (const m of s.matchAll(re)) {
    const v = Number((m[1] ?? "").replace(",", "."));
    if (Number.isFinite(v)) out.push(v);
  }
  return out;
}

export function initials(name: string): string {
  const words = name
    .replace(/[^\p{L}\p{N} ]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  const first = words[0] ?? "?";
  const second = words[1];
  return (second ? first[0]! + second[0]! : first.slice(0, 2)).toUpperCase();
}
