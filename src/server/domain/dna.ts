import type { ArticleVersion, RuleKind } from "@/lib/api/types";
import type { ArticleRecord, RuleRecord } from "../store/records";
import { normalize } from "./text";

/** Auteur des versions générées : les versions suivantes, humaines, sont des corrections. */
export const KORA_AUTHOR = "KORA";
const MIN_CORRECTIONS = 3;

export interface Correction {
  articleId: string;
  kora: ArticleVersion;
  human: ArticleVersion;
}

/** Paires (version KORA → version humaine suivante) : le corpus de corrections (WF6). */
export function collectCorrections(articles: ArticleRecord[]): Correction[] {
  const out: Correction[] = [];
  for (const a of articles) {
    const versions = [...a.versions].sort((x, y) => x.n - y.n);
    for (let i = 0; i < versions.length - 1; i++) {
      const v = versions[i]!;
      const next = versions[i + 1]!;
      if (v.createdBy === KORA_AUTHOR && next.createdBy !== KORA_AUTHOR) {
        out.push({ articleId: a.id, kora: v, human: next });
      }
    }
  }
  return out;
}

export interface ProposalCandidate {
  kind: RuleKind;
  proposedText: string;
  ruleId: string | null;
  basedOnCorrections: number;
  rationale: string;
  signature: string;
}

function words(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[«»"“”.,;:!?()[\]]/g, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^['’-]+|['’-]+$/g, ""))
    .filter((w) => w.length >= 4);
}

function bigrams(s: string): string[] {
  const w = s
    .toLowerCase()
    .replace(/[«»"“”.,;:!?()[\]]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < w.length - 1; i++) {
    const a = w[i]!;
    const b = w[i + 1]!;
    if (a.length >= 4 && b.length >= 4) out.push(`${a} ${b}`);
  }
  return out;
}

/**
 * Analyse des corrections humaines : propose des mises à jour du référentiel éditorial.
 * Rien n'est appliqué automatiquement : chaque proposition attend une décision explicite.
 */
export function analyzeCorrections(
  corrections: Correction[],
  rules: RuleRecord[],
): ProposalCandidate[] {
  const out: ProposalCandidate[] = [];

  const shortened = corrections.filter((c) => c.human.title.length < c.kora.title.length * 0.85);
  if (shortened.length >= MIN_CORRECTIONS) {
    const avgKora = Math.round(
      shortened.reduce((s, c) => s + c.kora.title.length, 0) / shortened.length,
    );
    const avgHuman = Math.round(
      shortened.reduce((s, c) => s + c.human.title.length, 0) / shortened.length,
    );
    const target = Math.max(40, Math.ceil(avgHuman / 5) * 5);
    const rule = rules.find((r) => r.kind === "longueur" && normalize(r.text).includes("titre"));
    out.push({
      kind: "longueur",
      proposedText: `Titres de ${target} caractères maximum.`,
      ruleId: rule?.id ?? null,
      basedOnCorrections: shortened.length,
      rationale: `Sur ${shortened.length} corrections, les titres proposés par KORA ont été raccourcis en moyenne de ${avgKora} à ${avgHuman} caractères.`,
      signature: "longueur:titre",
    });
  }

  const removedCount = new Map<string, number>();
  const addedBigrams = new Map<string, number>();
  const pairCount = new Map<string, number>();
  for (const c of corrections) {
    const koraText = `${c.kora.chapo} ${c.kora.body}`;
    const humanText = `${c.human.chapo} ${c.human.body}`;
    const kw = new Set(words(koraText));
    const hw = new Set(words(humanText));
    const removed = [...kw].filter((w) => !hw.has(w));
    const kb = new Set(bigrams(koraText));
    const added = [...new Set(bigrams(humanText))].filter(
      (b) => !kb.has(b) && b.split(" ").every((x) => !kw.has(x)),
    );
    for (const r of removed) removedCount.set(r, (removedCount.get(r) ?? 0) + 1);
    for (const a of added) addedBigrams.set(a, (addedBigrams.get(a) ?? 0) + 1);
    for (const r of removed)
      for (const a of added) pairCount.set(`${r}→${a}`, (pairCount.get(`${r}→${a}`) ?? 0) + 1);
  }

  const replaced = new Set<string>();
  const pairs = [...pairCount.entries()]
    .filter(([key, n]) => {
      const [r = "", a = ""] = key.split("→");
      return n >= MIN_CORRECTIONS && n === removedCount.get(r) && n === addedBigrams.get(a);
    })
    .sort((x, y) => y[1] - x[1]);
  for (const [key, n] of pairs) {
    const [r = "", a = ""] = key.split("→");
    if (replaced.has(r)) continue;
    replaced.add(r);
    const rule = rules.find(
      (x) => x.kind === "vocabulaire" && normalize(x.text).includes(normalize(r)),
    );
    out.push({
      kind: "vocabulaire",
      proposedText: `Préférer « ${a} » à « ${r} ».`,
      ruleId: rule?.id ?? null,
      basedOnCorrections: n,
      rationale: `Dans ${n} corrections, « ${r} » a été remplacé par « ${a} ».`,
      signature: `vocabulaire:${normalize(r)}`,
    });
  }

  for (const [word, n] of [...removedCount.entries()].sort((x, y) => y[1] - x[1])) {
    if (n < MIN_CORRECTIONS || replaced.has(word)) continue;
    const rule = rules.find(
      (x) => x.kind === "interdit" && normalize(x.text).includes(normalize(word)),
    );
    if (rule) continue;
    out.push({
      kind: "interdit",
      proposedText: `Éviter le terme « ${word} ».`,
      ruleId: null,
      basedOnCorrections: n,
      rationale: `Le terme « ${word} » a été supprimé par l'équipe dans ${n} corrections.`,
      signature: `interdit:${normalize(word)}`,
    });
  }
  return out;
}
