import type { Dossier, DossierInput, LinkedInInput } from "./text-model";
import type { LinkedInVariant } from "@/lib/api/types";

/**
 * Amélioration IA (OpenAI) des textes produits par le modèle à gabarits.
 * La clé est lue côté serveur uniquement (AI_API_KEY). En cas d'erreur ou
 * d'absence de clé, l'appelant retombe sur le texte gabarit : jamais de crash.
 */
export interface AiTextEnhancer {
  enhanceDossier(input: DossierInput, base: Dossier): Promise<Dossier>;
  enhanceLinkedInVariants(
    input: LinkedInInput,
    base: Omit<LinkedInVariant, "id">[],
  ): Promise<Omit<LinkedInVariant, "id">[]>;
  enhanceSummary(input: { title: string; text: string }, base: string): Promise<string>;
}

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const MODEL = "gpt-4o-mini";

async function chat(system: string, user: string): Promise<string | null> {
  const key = process.env["AI_API_KEY"];
  if (!key) return null;
  try {
    const res = await fetch(OPENAI_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0.4,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    return data.choices?.[0]?.message?.content?.trim() || null;
  } catch {
    return null;
  }
}

/** Extrait un objet JSON d'une réponse (tolère le texte autour). */
function parseJson<T>(raw: string): T | null {
  const m = /\{[\s\S]*\}/.exec(raw);
  if (!m) return null;
  try {
    return JSON.parse(m[0]) as T;
  } catch {
    return null;
  }
}

const STYLE =
  "Tu es un rédacteur en chef du média KORA, qui couvre l'écosystème tech d'Inovallée (Grenoble). " +
  "Style : journalistique, factuel, en français, sans sensationnalisme. " +
  "Règle absolue : n'invente AUCUN fait, chiffre ou citation. Utilise uniquement les éléments fournis. " +
  "Conserve les marqueurs « [À vérifier] » devant toute information non corroborée.";

export class OpenAiEnhancer implements AiTextEnhancer {
  async enhanceDossier(input: DossierInput, base: Dossier): Promise<Dossier> {
    const facts = base.factChecks.map((f) => `- [${f.status}] ${f.claim}`).join("\n");
    const raw = await chat(
      STYLE,
      `À partir de ces faits vérifiés, réécris l'article.\n\n` +
        `Signal : ${input.signal.title}\nAngle : ${input.angle ?? input.signal.suggestedAngle.text}\n\n` +
        `Faits du dossier :\n${facts}\n\n` +
        `Brouillon actuel :\nTitre : ${base.draft.title}\nChapô : ${base.draft.chapo}\nCorps :\n${base.draft.body}\n\n` +
        `Réponds en JSON uniquement : {"title": "...", "chapo": "...", "body": "..."}. ` +
        `Le corps garde la section « Sources consultées » à la fin, reprise à l'identique.`,
    );
    const parsed = raw ? parseJson<{ title?: string; chapo?: string; body?: string }>(raw) : null;
    if (!parsed?.title || !parsed.chapo || !parsed.body) return base;
    return {
      ...base,
      draft: {
        ...base.draft,
        title: parsed.title,
        chapo: parsed.chapo,
        body: parsed.body,
        excerpt: parsed.chapo.slice(0, 200),
        seoTitle: parsed.title.slice(0, 60),
      },
    };
  }

  async enhanceLinkedInVariants(
    input: LinkedInInput,
    base: Omit<LinkedInVariant, "id">[],
  ): Promise<Omit<LinkedInVariant, "id">[]> {
    const raw = await chat(
      STYLE,
      `Écris 2 variantes d'un post LinkedIn pour cette actualité.\n\n` +
        `Titre : ${input.title}\nChapô : ${input.lead}\n` +
        `Entreprise : ${input.companyName ?? "inconnue"}\n\n` +
        `Réponds en JSON uniquement : {"variants": [{"text": "...", "hashtags": ["#Inovallée", ...]}, ...]}. ` +
        `Ton professionnel, 600 caractères max par variante, hashtags pertinents dont #Inovallée.`,
    );
    const parsed = raw
      ? parseJson<{ variants?: { text?: string; hashtags?: string[] }[] }>(raw)
      : null;
    const variants = parsed?.variants?.filter((v) => v.text && v.hashtags?.length);
    if (!variants || variants.length === 0) return base;
    return variants.slice(0, 3).map((v) => ({ text: v.text!, hashtags: v.hashtags! }));
  }

  async enhanceSummary(input: { title: string; text: string }, base: string): Promise<string> {
    const raw = await chat(
      STYLE,
      `Résume cette actualité en 2 phrases maximum pour une newsletter.\n\n` +
        `Titre : ${input.title}\nTexte : ${input.text}\n\n` +
        `Réponds avec le résumé seul, sans guillemets.`,
    );
    return raw && raw.length > 20 ? raw.slice(0, 400) : base;
  }
}
