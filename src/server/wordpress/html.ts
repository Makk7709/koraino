import { UNVERIFIED } from "../adapters/text-model";

const BRACKETS: Record<string, string> = { "[": "&#91;", "]": "&#93;" };

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
  ...BRACKETS,
};

/**
 * Échappe aussi les crochets : WordPress exécute les shortcodes du contenu, y compris dans les
 * attributs entre guillemets (`href`). L'entité se décode en `[` : affichage et URL identiques.
 */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"'[\]]/g, (c) => ESCAPES[c]!);
}

/** Texte brut envoyé tel quel (extrait) : seuls les crochets sont neutralisés. */
export function neutralizeShortcodes(text: string): string {
  return text.replace(/[[\]]/g, (c) => BRACKETS[c]!);
}

/** Entités nommées produites par WordPress (esc_html, wptexturize) et le français courant. */
const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
  hellip: "…",
  ndash: "–",
  mdash: "—",
  lsquo: "‘",
  rsquo: "’",
  sbquo: "‚",
  ldquo: "“",
  rdquo: "”",
  laquo: "«",
  raquo: "»",
  euro: "€",
  copy: "©",
  reg: "®",
  trade: "™",
  agrave: "à",
  acirc: "â",
  ccedil: "ç",
  eacute: "é",
  egrave: "è",
  ecirc: "ê",
  euml: "ë",
  icirc: "î",
  iuml: "ï",
  ocirc: "ô",
  oelig: "œ",
  ugrave: "ù",
  ucirc: "û",
  Agrave: "À",
  Eacute: "É",
  Egrave: "È",
  Ecirc: "Ê",
  Ccedil: "Ç",
};

/** Décode les entités HTML des textes renvoyés par WordPress (`&amp;`, `&#8217;`, `&#x2019;`…). */
export function decodeEntities(text: string): string {
  return text.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith("#")) {
      const hex = entity[1] === "x" || entity[1] === "X";
      const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return NAMED[entity] ?? match;
  });
}

/** Texte brut d'un fragment HTML court (message d'erreur, titre rendu). */
export function htmlToText(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

/** Clé de comparaison : entités décodées, espaces normalisés, insensible à la casse. */
export function textKey(text: string): string {
  return decodeEntities(text).normalize("NFC").replace(/\s+/g, " ").trim().toLocaleLowerCase("fr");
}

const URL_PATTERN = /https?:\/\/[^\s<>"'«»]+/g;
const TRAILING = ".,;:!?…";

const count = (text: string, char: string) => text.split(char).length - 1;

/** Ponctuation finale exclue du lien ; une parenthèse fermante n'est gardée que si elle est ouverte dans l'URL. */
function trimUrl(url: string): string {
  let end = url.length;
  while (end > 0) {
    const head = url.slice(0, end);
    const last = head[end - 1]!;
    if (TRAILING.includes(last)) end -= 1;
    else if (last === ")" && count(head, ")") > count(head, "(")) end -= 1;
    else if (last === "]" && count(head, "]") > count(head, "[")) end -= 1;
    else break;
  }
  return url.slice(0, end);
}

const MARK = escapeHtml(UNVERIFIED);

function plain(text: string): string {
  return escapeHtml(text).split(MARK).join(`<mark>${MARK}</mark>`);
}

function inline(text: string): string {
  let out = "";
  let last = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    const url = trimUrl(match[0]);
    if (!/^https?:\/\/[^/.]/.test(url)) continue;
    const start = match.index;
    out += `${plain(text.slice(last, start))}<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>`;
    last = start + url.length;
  }
  return out + plain(text.slice(last));
}

const LIST_ITEM = /^\s*- (.*)$/;

/**
 * Contenu HTML du brouillon : tout le texte est échappé ; chapô en tête, en gras ; paragraphes
 * séparés par une ligne vide, retour simple = `<br>` ; lignes « - » consécutives = liste (même
 * séparées par une ligne vide) ; URL cliquables ; marqueurs « [À vérifier] » surlignés pour le
 * relecteur WordPress.
 */
export function toWordPressHtml(chapo: string, body: string): string {
  const parts: string[] = [];
  const lead = chapo.replace(/\r\n?/g, "\n").trim();
  if (lead) {
    const lines = lead
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    parts.push(`<p><strong>${lines.map(inline).join("<br>")}</strong></p>`);
  }
  let items: string[] = [];
  let paragraph: string[] = [];
  const flushList = () => {
    if (items.length) parts.push(`<ul>${items.map((i) => `<li>${inline(i)}</li>`).join("")}</ul>`);
    items = [];
  };
  const flushParagraph = () => {
    if (paragraph.length) parts.push(`<p>${paragraph.map(inline).join("<br>")}</p>`);
    paragraph = [];
  };
  for (const block of body.replace(/\r\n?/g, "\n").split(/\n[ \t]*\n/)) {
    for (const raw of block.split("\n")) {
      const line = raw.trim();
      if (!line) continue;
      const item = LIST_ITEM.exec(raw)?.[1]?.trim();
      if (item === "") continue;
      if (item) {
        flushParagraph();
        items.push(item);
      } else {
        flushList();
        paragraph.push(line);
      }
    }
    flushParagraph();
  }
  flushList();
  return parts.join("\n");
}
