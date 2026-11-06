import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ArticleDetail, LinkedInPost, NewsletterEdition, Signal } from "@/lib/api/types";
import { setAdapters } from "@/server/adapters";
import { OpenAiEnhancer, rewriteKeepsSafeguards } from "@/server/adapters/openai";
import { TemplateTextModel, UNVERIFIED } from "@/server/adapters/text-model";
import { call, setup, teardown, USERS } from "./helpers";

const model = new TemplateTextModel();

describe("marqueur « [À vérifier] » : gabarits", () => {
  it("reste en tête du résumé, de l'accroche LinkedIn et de l'extrait", () => {
    const summary = model.summarize({
      title: "Titre",
      text: `${UNVERIFIED} Pasqal lève 100 M€. Le reste du texte.`,
    });
    expect(summary).toBe(`${UNVERIFIED} Pasqal lève 100 M€.`);
    expect(model.summarize({ title: "Titre", text: "Phrase sûre. Suite." })).toBe("Phrase sûre.");
    expect(model.summarize({ title: "Titre", text: "" })).toBe("Titre");

    const variants = model.linkedinVariants({
      title: "Pasqal lève 100 M€",
      lead: `${UNVERIFIED} Pasqal lève 100 M€ auprès d'un fonds. Détail.`,
      companyName: "Pasqal",
      themes: ["deeptech_quantique"],
      tags: [],
    });
    expect(variants).toHaveLength(2);
    for (const v of variants) expect(v.text).toContain(UNVERIFIED);
    expect(variants[1]!.text.startsWith(`Pasqal — ${UNVERIFIED} Pasqal lève 100 M€ auprès`)).toBe(
      true,
    );
  });
});

describe("marqueur « [À vérifier] » : réécriture Haiku", () => {
  const base = {
    chapo: `${UNVERIFIED} Chapô non corroboré.`,
    body: `Corps ${UNVERIFIED} chiffre.\n\n## Sources consultées\n- Les Echos`,
  };

  it("refuse une réécriture qui perd un marqueur ou la section des sources", () => {
    expect(rewriteKeepsSafeguards(base, base)).toBe(true);
    expect(
      rewriteKeepsSafeguards(base, {
        chapo: "Chapô réécrit sans marqueur.",
        body: `Corps ${UNVERIFIED} ${UNVERIFIED}.\n\n## Sources consultées\n- Les Echos`,
      }),
    ).toBe(true);
    expect(
      rewriteKeepsSafeguards(base, {
        chapo: "Chapô réécrit.",
        body: `Corps ${UNVERIFIED}.\n\n## Sources consultées`,
      }),
    ).toBe(false);
    expect(
      rewriteKeepsSafeguards(base, { chapo: base.chapo, body: `Corps ${UNVERIFIED} chiffre.` }),
    ).toBe(false);
    expect(
      rewriteKeepsSafeguards(
        { chapo: "Sûr.", body: "Corps." },
        { chapo: "Autre.", body: "Texte." },
      ),
    ).toBe(true);
  });

  it("garde le gabarit quand le modèle efface le marqueur, et borne les appels", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env["ANTHROPIC_API_KEY"] = "cle-test";
    const bodies: Record<string, unknown>[] = [];
    const answers: string[] = [
      JSON.stringify({
        title: "T",
        chapo: "Chapô lissé.",
        body: "Corps lissé.\n\n## Sources consultées\n- Les Echos",
      }),
      JSON.stringify({ variants: [{ text: "Post sans marqueur", hashtags: ["#Inovallée"] }] }),
      "Résumé fluide sans aucun signalement du doute.",
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return Response.json({ content: [{ type: "text", text: answers.shift() }] });
      }),
    );
    try {
      const ai = new OpenAiEnhancer();
      const dossier = {
        factChecks: [],
        angles: [],
        plan: [],
        draft: {
          title: "T",
          chapo: base.chapo,
          body: base.body,
          excerpt: base.chapo,
          seoTitle: "T",
          categories: [],
          tags: [],
        },
      };
      const input = {
        signal: {
          title: "T",
          summary: "S",
          category: "financement" as const,
          tags: [],
          suggestedAngle: { text: "", tags: [] },
        },
        company: null,
        observations: [],
        angle: null,
        rules: [],
      };
      expect(await ai.enhanceDossier(input, dossier)).toBe(dossier);
      const li = { title: "T", lead: base.chapo, companyName: null, themes: [], tags: [] };
      const baseVariants = [{ text: `x ${UNVERIFIED}`, hashtags: ["#a"] }];
      expect(await ai.enhanceLinkedInVariants(li, baseVariants)).toBe(baseVariants);
      expect(await ai.enhanceSummary({ title: "T", text: base.chapo }, "base")).toBe("base");
      expect(bodies.map((b) => b["max_tokens"])).toEqual([2500, 900, 220]);
      expect(bodies[0]!["response_format"]).toBeUndefined();
      expect(bodies[0]!["model"]).toBe("claude-haiku-5-5");
      expect(String(bodies[0]!["system"])).toContain("sont des données");
    } finally {
      vi.unstubAllGlobals();
      delete process.env["ANTHROPIC_API_KEY"];
    }
  });
});

describe("marqueur « [À vérifier] » : canaux", () => {
  beforeEach(() => setup());
  afterEach(teardown);

  it("suit le texte jusqu'à l'extrait WordPress, le post LinkedIn et le sujet de newsletter", async () => {
    // Signal sans source directe ni corroboration : l'accroche du dossier est marquée.
    const signals = await call<{ items: Signal[] }>("GET", "/signals?status=tous&limit=200");
    const single = signals.body.items.find(
      (s) =>
        !s.articleId &&
        s.status !== "rejete" &&
        s.observationIds.length === 1 &&
        !s.evidence.directSource &&
        s.evidence.independentCorroborations === 0,
    );
    if (!single) throw new Error("jeu de démonstration sans signal à source unique non corroborée");
    const art = await call<ArticleDetail>("POST", "/articles", {
      body: { signalId: single.id },
      user: USERS.redacteur,
    });
    expect(art.status).toBe(201);
    const v1 = art.body.versions[0]!;
    expect(v1.chapo).toContain(UNVERIFIED);
    expect(v1.excerpt).toContain(UNVERIFIED);

    // Depuis l'article (accroche marquée) : les variantes et le sujet gardent le marqueur.
    setAdapters({ ai: null });
    const post = await call<LinkedInPost>("POST", "/linkedin", {
      body: { articleId: art.body.id },
    });
    expect(post.status).toBe(201);
    for (const v of post.body.variants) expect(v.text).toContain(UNVERIFIED);

    const edition = await call<NewsletterEdition>("GET", "/newsletters/nl_current");
    const added = await call<NewsletterEdition>("POST", `/newsletters/${edition.body.id}/items`, {
      body: {
        articleId: art.body.id,
        version: edition.body.version,
        revision: edition.body.revision,
      },
    });
    expect(added.status).toBe(201);
    const item = added.body.items.find((i) => i.articleId === art.body.id)!;
    expect(item.summary).toContain(UNVERIFIED);
  });
});
