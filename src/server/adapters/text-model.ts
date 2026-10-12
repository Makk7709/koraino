import type {
  ArticleVersion,
  Category,
  Criterion,
  EditorialRule,
  FactCheck,
  LinkedInVariant,
  Observation,
  ScoreResult,
  Theme,
} from "@/lib/api/types";
import { detectContradictions } from "../domain/evidence";
import { firstSentence, normalize, textSimilarity, truncate } from "../domain/text";
import { ANGLE_TEMPLATES, CATEGORY_LABEL, THEME_TAGS } from "../store/catalog";
import type { CompanyRecord } from "../store/records";

export const UNVERIFIED = "[À vérifier]";

export interface DossierInput {
  signal: {
    title: string;
    summary: string;
    category: Category;
    tags: string[];
    suggestedAngle: { text: string; tags: string[] };
  };
  company: CompanyRecord | null;
  observations: Observation[];
  angle: string | null;
  rules: EditorialRule[];
}

export interface Dossier {
  factChecks: Omit<FactCheck, "id">[];
  angles: string[];
  plan: string[];
  draft: Pick<
    ArticleVersion,
    "title" | "chapo" | "body" | "excerpt" | "seoTitle" | "categories" | "tags"
  >;
}

export interface LinkedInInput {
  title: string;
  lead: string;
  companyName: string | null;
  themes: Theme[];
  tags: string[];
}

/**
 * Modèle de texte. L'implémentation par défaut est déterministe et n'invente aucun fait :
 * chaque phrase factuelle provient d'une observation du dossier ; les éléments non corroborés
 * sont marqués « [À vérifier] ». Aucune citation n'est créée.
 */
export interface TextModel {
  readonly name: string;
  generateDossier(input: DossierInput): Dossier;
  linkedinVariants(input: LinkedInInput): Omit<LinkedInVariant, "id">[];
  summarize(input: { title: string; text: string }): string;
  editorialNotes(input: {
    category: Category;
    companyName: string | null;
    score: Pick<ScoreResult, "subScores" | "reasons">;
  }): { whyInteresting: string[]; suggestedAngle: { text: string; tags: string[] } };
}

const dateFmt = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

function titleLimit(rules: EditorialRule[]): number | null {
  for (const r of rules) {
    if (!r.active || r.kind !== "longueur") continue;
    const n = normalize(r.text);
    if (!n.includes("titre")) continue;
    const m = /(\d{2,3})\s*caracteres/.exec(n);
    if (m) return Number(m[1]);
  }
  return null;
}

function isDirect(o: Observation, company: CompanyRecord | null): boolean {
  return !!company && o.outlet.domain === company.domain;
}

interface Claim {
  text: string;
  observations: Observation[];
}

export class TemplateTextModel implements TextModel {
  readonly name = "kora-gabarits-v1";

  generateDossier(input: DossierInput): Dossier {
    const { company, observations, signal } = input;
    const ordered = [...observations].sort((a, b) => {
      const d = Number(isDirect(b, company)) - Number(isDirect(a, company));
      if (d) return d;
      const s = Number(a.isSyndicated) - Number(b.isSyndicated);
      if (s) return s;
      return (
        Date.parse(a.publishedAt ?? a.collectedAt) - Date.parse(b.publishedAt ?? b.collectedAt)
      );
    });

    const claims: Claim[] = [];
    for (const o of ordered) {
      const sentence = firstSentence(o.excerpt);
      if (!sentence) continue;
      const similar = claims.find((c) => textSimilarity(c.text, sentence) >= 0.5);
      if (similar) similar.observations.push(o);
      else if (o.isSyndicated && claims.length > 0) {
        const best = [...claims].sort(
          (a, b) => textSimilarity(b.text, sentence) - textSimilarity(a.text, sentence),
        )[0]!;
        best.observations.push(o);
      } else claims.push({ text: sentence, observations: [o] });
    }

    const factChecks: Omit<FactCheck, "id">[] = claims.map((c) => {
      const independent = new Set(
        c.observations.filter((o) => !o.isSyndicated).map((o) => o.outlet.domain),
      );
      const supported = c.observations.some((o) => isDirect(o, company)) || independent.size >= 2;
      return {
        claim: c.text,
        observationIds: c.observations.map((o) => o.id),
        status: supported ? "etaye" : "non_corrobore",
        resolution: null,
      };
    });
    for (const contradiction of detectContradictions(observations)) {
      factChecks.push({
        claim: contradiction,
        observationIds: observations.filter((o) => !o.isSyndicated).map((o) => o.id),
        status: "contradictoire",
        resolution: null,
      });
    }

    const outletsOf = (c: Claim) =>
      [...new Set(c.observations.map((o) => o.outlet.name))].join(", ");
    const lines: string[] = [];
    claims.forEach((c, i) => {
      const fc = factChecks[i]!;
      if (fc.status === "etaye") lines.push(`${c.text} (sources : ${outletsOf(c)})`);
      else lines.push(`${UNVERIFIED} ${c.text} (source unique : ${outletsOf(c)})`);
    });
    for (const fc of factChecks.filter((f) => f.status === "contradictoire")) {
      lines.push(
        `${UNVERIFIED} ${fc.claim}. Le chiffre doit être confirmé auprès de l'entreprise avant toute diffusion.`,
      );
    }
    const sources = ordered.map(
      (o) =>
        `- ${o.outlet.name} — ${o.title} (${o.publishedAt ? dateFmt.format(new Date(o.publishedAt)) : "date inconnue"}) ${o.url}`,
    );

    const lead = claims[0];
    const leadStatus = factChecks[0]?.status;
    const chapo = lead
      ? leadStatus === "etaye"
        ? lead.text
        : `${UNVERIFIED} ${lead.text}`
      : `${UNVERIFIED} ${signal.summary}`;
    const body = [...lines.slice(1), "", "Sources consultées :", ...sources]
      .join("\n\n")
      .replace(/\n{3,}/g, "\n\n");

    const limit = titleLimit(input.rules);
    const candidates = [input.angle, signal.suggestedAngle.text, signal.title].filter(
      (t): t is string => !!t && t.trim().length > 0,
    );
    let title = candidates[0] ?? signal.title;
    if (limit && title.length > limit)
      title = candidates.find((t) => t.length <= limit) ?? truncate(title, limit);

    const companyName = company?.name ?? "L'entreprise";
    const angles = [
      ...new Set(
        [
          input.angle,
          signal.suggestedAngle.text,
          `${companyName} : ce que cette annonce change pour l'écosystème Inovallée`,
          ANGLE_TEMPLATES[signal.category].text(companyName),
        ].filter((a): a is string => !!a),
      ),
    ].slice(0, 4);

    const toVerify = factChecks.filter((f) => f.status !== "etaye").length;
    const plan = [
      `Accroche — ${truncate(lead?.text ?? signal.summary, 110)}`,
      company
        ? `Contexte — présenter ${company.name} (fiche registre : ${company.sector}, ${company.territory})`
        : "Contexte — entreprise à rattacher avant rédaction",
      `Les faits — ${factChecks.filter((f) => f.status === "etaye").length} élément(s) étayé(s) par le dossier`,
      ...(toVerify > 0
        ? [`Points de vigilance — ${toVerify} élément(s) à vérifier ou arbitrer`]
        : []),
      "Ouverture — enjeux pour l'écosystème Inovallée",
    ];

    const cleanChapo = chapo.replace(`${UNVERIFIED} `, "");
    return {
      factChecks,
      angles,
      plan,
      draft: {
        title,
        chapo,
        body,
        excerpt: truncate(cleanChapo, 200),
        seoTitle: truncate(title, 60),
        categories: [CATEGORY_LABEL[signal.category]],
        tags: [...signal.tags],
      },
    };
  }

  linkedinVariants(input: LinkedInInput): Omit<LinkedInVariant, "id">[] {
    const hashtags = [
      "#Inovallée",
      "#Grenoble",
      ...input.themes.slice(0, 2).map((t) => `#${THEME_TAGS[t].replace(/[^\p{L}\p{N}]/gu, "")}`),
    ];
    const lead = input.lead.replace(`${UNVERIFIED} `, "");
    return [
      {
        text: `🚀 ${input.title}\n\n${lead}\n\n👉 À lire sur le site d'Inovallée.`,
        hashtags,
      },
      {
        text: `${input.companyName ? `${input.companyName} — ` : ""}${firstSentence(lead)}\n\nUne actualité de l'écosystème Inovallée à suivre de près. 💡`,
        hashtags: hashtags.slice(0, 3),
      },
    ];
  }

  summarize(input: { title: string; text: string }): string {
    const text = input.text.replace(`${UNVERIFIED} `, "").trim() || input.title;
    return truncate(firstSentence(text), 280);
  }

  editorialNotes(input: {
    category: Category;
    companyName: string | null;
    score: Pick<ScoreResult, "subScores" | "reasons">;
  }) {
    const ranked = (Object.keys(input.score.subScores) as Criterion[]).sort(
      (a, b) => input.score.subScores[b] - input.score.subScores[a],
    );
    const whyInteresting = ranked.slice(0, 3).map((c) => input.score.reasons[c]);
    const tpl = ANGLE_TEMPLATES[input.category];
    return {
      whyInteresting,
      suggestedAngle: {
        text: tpl.text(input.companyName ?? "Entreprise à rattacher"),
        tags: [...tpl.tags],
      },
    };
  }
}
