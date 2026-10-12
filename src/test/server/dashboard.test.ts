import { afterEach, describe, expect, it } from "vitest";
import type { Dashboard, Paginated, Signal } from "@/lib/api/types";
import { call, NOW, setup, teardown } from "./helpers";

afterEach(teardown);

function summary(d: Dashboard) {
  return {
    kpis: d.kpis.map((k) => [k.key, k.value, k.trend, k.label]),
    groups: d.groups.map((g) => [g.key, g.total, g.items.map((i) => [i.label, i.count])]),
    activity: [d.activity.totalSignals, d.activity.totalArticles, d.activity.trend],
  };
}

const MOCKUP = {
  kpis: [
    ["companies", 150, "+12%", "entreprises suivies"],
    ["signals", 24, "+33%", "signaux détectés"],
    ["priority_topics", 8, "+2", "sujets prioritaires"],
    ["wordpress_drafts", 3, "+3", "brouillons WordPress"],
    ["linkedin_to_validate", 5, "+67%", "posts LinkedIn à valider"],
  ],
  groups: [
    [
      "prioritaires",
      8,
      [
        ["Deeptech & quantique", 3],
        ["IA & industrie", 2],
        ["Transition énergétique", 2],
        ["Talents & RH", 1],
      ],
    ],
    [
      "a_surveiller",
      12,
      [
        ["International", 4],
        ["Partenariats stratégiques", 3],
        ["Levées de fonds", 3],
        ["Nouveaux produits", 2],
      ],
    ],
    [
      "traites",
      28,
      [
        ["Levées de fonds", 8],
        ["Distinctions & prix", 6],
        ["Innovation produit", 7],
        ["Croissance & international", 7],
      ],
    ],
  ],
  activity: [128, 86, "+42%"],
};

describe("dashboard", () => {
  it.each([
    ["en milieu de matinée", NOW],
    ["juste après minuit", new Date(2026, 9, 12, 0, 40)],
    ["en fin de soirée", new Date(2026, 2, 31, 23, 10)],
  ])("reproduit les chiffres de la maquette (%s)", async (_label, at) => {
    setup(at);
    const res = await call<Dashboard>("GET", "/dashboard");
    expect(res.status).toBe(200);
    expect(summary(res.body)).toEqual(MOCKUP);
  });

  it("calcule les cartes basses à partir des données", async () => {
    setup();
    const { body: d } = await call<Dashboard>("GET", "/dashboard");
    expect(d.kpis.every((k) => k.spark.length === 8 && k.trendDirection === "up")).toBe(true);
    expect(d.activity.points).toHaveLength(30);
    expect(d.activity.points.reduce((s, p) => s + p.signals, 0)).toBe(128);
    expect(d.activity.points.reduce((s, p) => s + p.articles, 0)).toBe(86);
    expect(Math.max(...d.activity.points.map((p) => p.signals))).toBeLessThanOrEqual(8);
    expect(d.latestWordpressDraft).toMatchObject({
      title: "Pasqal : 100 M€ pour faire rayonner le quantique européen",
      ready: true,
    });
    expect(Date.parse(d.latestWordpressDraft!.updatedAt)).toBe(NOW.getTime() - 2 * 3_600_000);
    expect(d.latestLinkedInPost?.status).toBe("a_valider");
    expect(d.latestLinkedInPost?.excerpt).toMatch(/^🚀 100 M€ pour Pasqal !/);
    expect(d.newsletter).toMatchObject({
      title: "L'actualité innovation en Auvergne-Rhône-Alpes",
      selectedCount: 12,
      includeNext: true,
      signalId: "sig_pasqal",
    });
    expect(Date.parse(d.newsletter!.scheduledFor)).toBeGreaterThan(NOW.getTime());
    expect(d.engine.active).toBe(true);
    expect(d.engine.sourcesCount).toBeGreaterThanOrEqual(250);
    expect(d.engine.features[0]).toBe("Veille multi-sources (250+ sources)");
    const icons = d.groups.flatMap((g) => g.items.map((i) => i.icon));
    expect(icons).toEqual([
      "atom",
      "cpu",
      "leaf",
      "users",
      "globe",
      "handshake",
      "lightbulb",
      "cog",
      "check",
      "trophy",
      "cog",
      "cog",
    ]);
  });

  it("liste les 5 signaux de la maquette en tête des plus récents", async () => {
    setup();
    const res = await call<Paginated<Signal>>("GET", "/signals?limit=5&sort=recent");
    expect(res.body.items.map((s) => [s.id, s.score.total, s.status])).toEqual([
      ["sig_pasqal", 92, "nouveau"],
      ["sig_verkor", 87, "a_traiter"],
      ["sig_wattpark", 81, "a_traiter"],
      ["sig_sinano", 79, "en_revue"],
      ["sig_araymond", 76, "a_traiter"],
    ]);
    const nouveaux = await call<Paginated<Signal>>("GET", "/signals?status=nouveau&limit=1");
    expect(nouveaux.body.total).toBe(12);
  });
});
