import { describe, expect, it } from "vitest";
import {
  classifyCategory,
  decideCluster,
  titleAffinity,
  titleEntities,
} from "@/server/domain/clustering";

describe("KORA — classification multilingue FR/EN", () => {
  const fr = "Kalray étend son partenariat avec Openchip pour 5 M€";
  const en = "Kalray extends its partnership with Openchip for 12 months";

  it.each([
    [fr, "partenariat"],
    [en, "partenariat"],
    ["Pasqal raises 50 million euros in a Series B funding round", "financement"],
    ["Kalray acquires the startup Nyris", "acquisition"],
    ["Kalray signs a supply contract with an industrial group", "contrat"],
    ["Kalray hires 20 engineers in France", "recrutement"],
  ] as const)("classe correctement : %s", (title, expected) => {
    expect(classifyCategory(title)).toBe(expected);
  });

  it("regroupe deux titres FR/EN du même événement", () => {
    const date = "2026-10-14T16:00:00.000Z";
    const frCategory = classifyCategory(fr);
    const enCategory = classifyCategory(en);

    expect(frCategory).toBe("partenariat");
    expect(enCategory).toBe("partenariat");

    const similarity = titleAffinity(fr, en, {
      exclude: ["Kalray"],
      sameCategory: frCategory === enCategory,
    });

    expect(similarity).toBeGreaterThanOrEqual(0.5);

    const signal = {
      id: "sig_test_openchip",
      companyId: "co_kalray",
      category: frCategory,
      title: fr,
      createdAt: date,
      publishedAt: date,
      eventDate: null,
    };

    const observation = {
      companyId: "co_kalray",
      title: en,
      excerpt: en,
      collectedAt: date,
      publishedAt: date,
    };

    const result = decideCluster(
      observation,
      enCategory,
      [{ signal, observations: [] }],
      ["Kalray"],
    );

    expect(result.kind).toBe("attach");
  });

  it("ne confond pas une durée de 12 mois avec 12 M€", () => {
    const entities = titleEntities(en, ["Kalray"]);

    expect(entities.has("openchip")).toBe(true);
    expect(entities.has("12m")).toBe(false);
  });

  it("ne fusionne pas deux partenariats avec des partenaires et montants différents", () => {
    const other = "Kalray extends its partnership with Arrow for 2 M€";

    const similarity = titleAffinity(fr, other, {
      exclude: ["Kalray"],
      sameCategory: true,
    });

    expect(similarity).toBeLessThan(0.5);
  });
});
