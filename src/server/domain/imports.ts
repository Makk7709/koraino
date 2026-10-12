import { strFromU8, unzipSync } from "fflate";
import type { ImportProposal } from "@/lib/api/types";
import { decodeEntities } from "./security";
import { containsPhrase, truncate } from "./text";

export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
const MAX_DOCX_XML_BYTES = 50 * 1024 * 1024;
export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export type ImportFormat = "txt" | "docx";

export class ImportFormatError extends Error {
  constructor(
    public code: "unsupported_format" | "invalid_encoding" | "invalid_docx",
    message: string,
  ) {
    super(message);
  }
}

export function detectFormat(filename: string, mime: string): ImportFormat | null {
  const lower = filename.toLowerCase();
  if (
    lower.endsWith(".txt") &&
    (mime === "" || mime.startsWith("text/plain") || mime === "application/octet-stream")
  ) {
    return "txt";
  }
  if (
    lower.endsWith(".docx") &&
    (mime === "" ||
      mime === DOCX_MIME ||
      mime === "application/octet-stream" ||
      mime === "application/zip")
  ) {
    return "docx";
  }
  return null;
}

/** Texte UTF-8 strict (BOM retiré). */
export function decodeTxt(bytes: Uint8Array): string {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return text.replace(/^\uFEFF/, "");
  } catch {
    throw new ImportFormatError("invalid_encoding", "Le fichier texte doit être encodé en UTF-8.");
  }
}

/** Paragraphes de `word/document.xml` (texte des runs, tabulations et sauts de ligne). */
export function extractDocxParagraphs(bytes: Uint8Array): string[] {
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new ImportFormatError(
      "invalid_docx",
      "Le fichier .docx est invalide (archive non reconnue).",
    );
  }
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter: (f) => f.name === "word/document.xml" && f.originalSize <= MAX_DOCX_XML_BYTES,
    });
  } catch {
    throw new ImportFormatError("invalid_docx", "Le fichier .docx est invalide ou corrompu.");
  }
  const xmlBytes = files["word/document.xml"];
  if (!xmlBytes) {
    throw new ImportFormatError(
      "invalid_docx",
      "Le fichier .docx ne contient pas de document Word lisible.",
    );
  }
  const xml = strFromU8(xmlBytes);
  const paragraphs: string[] = [];
  const paraRe = /<w:p[\s>][\s\S]*?<\/w:p>|<w:p\/>/g;
  for (const m of xml.matchAll(paraRe)) {
    const p = m[0];
    let text = "";
    const tokenRe = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br\/>|<w:cr\/>/g;
    for (const t of p.matchAll(tokenRe)) {
      if (t[1] !== undefined) text += decodeEntities(t[1]);
      else if (t[0] === "<w:tab/>") text += "\t";
      else text += "\n";
    }
    paragraphs.push(text);
  }
  return paragraphs;
}

/**
 * Original et texte extrait restent distincts. Pour un TXT, l'original est le contenu du
 * fichier ; l'extrait ne normalise que les fins de ligne. Pour un DOCX, l'original est le texte
 * des paragraphes tel quel, l'extrait la suite des paragraphes non vides.
 */
export function extractTexts(
  format: ImportFormat,
  bytes: Uint8Array,
): { originalText: string; extractedText: string } {
  if (format === "txt") {
    const originalText = decodeTxt(bytes);
    return { originalText, extractedText: originalText.replace(/\r\n?/g, "\n") };
  }
  const paragraphs = extractDocxParagraphs(bytes);
  return {
    originalText: paragraphs.join("\n"),
    extractedText: paragraphs.filter((p) => p.trim() !== "").join("\n\n"),
  };
}

export interface ProposalDraft {
  kind: ImportProposal["kind"];
  before: string;
  after: string;
  rationale: string;
  start: number;
  end: number;
}

const NBSP = "\u00a0";
const NNBSP = "\u202f";

/**
 * Propositions de correction : chacune porte sur un passage exact (positions conservées) et
 * reste en attente de validation humaine. Aucune n'est appliquée sans acceptation.
 */
export function buildProposals(
  text: string,
  links: { name: string; href: string; label: string }[] = [],
): ProposalDraft[] {
  const found: ProposalDraft[] = [];

  for (const m of text.matchAll(/(\S)( ?)([:;?!])(?=\s|$)/g)) {
    const [whole, prev = "", , punct = ""] = m;
    if (/[\d/]/.test(prev) && punct === ":") continue;
    const start = m.index ?? 0;
    const insec = punct === ":" ? NBSP : NNBSP;
    found.push({
      kind: "correction",
      before: whole,
      after: `${prev}${insec}${punct}`,
      rationale: `Typographie française : espace insécable avant « ${punct} ».`,
      start,
      end: start + whole.length,
    });
  }

  for (const m of text.matchAll(/"([^"\n]{1,300})"/g)) {
    const inner = (m[1] ?? "").trim();
    found.push({
      kind: "mise_en_forme",
      before: m[0],
      after: `«${NBSP}${inner}${NBSP}»`,
      rationale: "Guillemets français « » avec espaces insécables.",
      start: m.index ?? 0,
      end: (m.index ?? 0) + m[0].length,
    });
  }

  for (const m of text.matchAll(/(?<=\S) {2,}(?=\S)/g)) {
    found.push({
      kind: "correction",
      before: m[0],
      after: " ",
      rationale: "Suppression d'une double espace.",
      start: m.index ?? 0,
      end: (m.index ?? 0) + m[0].length,
    });
  }

  for (const link of links) {
    if (!containsPhrase(text, link.name)) continue;
    const idx = text.indexOf(link.name);
    if (idx < 0) continue;
    found.push({
      kind: "enrichissement",
      before: link.name,
      after: `[${link.name}](${link.href})`,
      rationale: `Lien interne suggéré vers ${link.label}.`,
      start: idx,
      end: idx + link.name.length,
    });
  }

  found.sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: ProposalDraft[] = [];
  let lastEnd = -1;
  for (const p of found) {
    if (p.start < lastEnd) continue;
    kept.push(p);
    lastEnd = p.end;
    if (kept.length >= 60) break;
  }
  return kept;
}

/** Applique uniquement les propositions acceptées, de la fin vers le début (positions exactes). */
export function applyAccepted(
  text: string,
  proposals: {
    start: number;
    end: number;
    before: string;
    after: string;
    decision: ImportProposal["decision"];
  }[],
): string {
  let out = text;
  const accepted = proposals
    .filter((p) => p.decision === "acceptee")
    .sort((a, b) => b.start - a.start);
  for (const p of accepted) {
    if (out.slice(p.start, p.end) !== p.before) continue;
    out = out.slice(0, p.start) + p.after + out.slice(p.end);
  }
  return out;
}

/** Découpe un texte humain en titre, chapô et corps (aucun mot ajouté ni retiré). */
export function splitArticle(
  text: string,
  fallbackTitle: string,
): { title: string; chapo: string; body: string } {
  const paragraphs = text
    .split(/\n\s*\n|\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const [first = "", second = "", ...rest] = paragraphs;
  if (paragraphs.length >= 3 && first.length <= 180) {
    return { title: first, chapo: second, body: rest.join("\n\n") };
  }
  if (paragraphs.length === 2 && first.length <= 180) {
    return { title: first, chapo: "", body: second };
  }
  return { title: truncate(fallbackTitle, 120), chapo: "", body: paragraphs.join("\n\n") };
}
