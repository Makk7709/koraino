import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CollectionRun, Paginated, Signal, SignalDetail, Source } from "@/lib/api/types";
import { setAdapters } from "@/server/adapters";
import { looksLikeIndexPage, type RawItem } from "@/server/adapters/collector";
import { decideCluster, titleAffinity, titleEntities } from "@/server/domain/clustering";
import { call, NOW, setup, teardown } from "./helpers";

const DAY = 86_400_000;

describe("entités et affinité de titres", () => {
  it("extrait partenaires, sigles et montants, sans le nom de l'entreprise", () => {
    const e = titleEntities(
      "Kalray prolonge de 12 mois son accord avec Openchip pour environ 5 M€",
      ["Kalray"],
    );
    expect([...e].sort()).toEqual(["5m", "openchip"]);
    expect(
      [
        ...titleEntities("Alpao signe avec le CEA et l'ESA un contrat de 3 millions d'euros", [
          "Alpao",
        ]),
      ].sort(),
    ).toEqual(["3m", "cea", "esa"]);
    expect([...titleEntities("Le Dauphiné Libéré : innovation", ["Kalray"])].sort()).toEqual([
      "dauphine",
      "libere",
    ]);
  });

  it("rapproche deux titres différents qui partagent les marqueurs d'un même événement", () => {
    const a = "Kalray prolonge de 12 mois son accord avec Openchip pour environ 5 M€";
    const b = "Kalray : extension du partenariat avec Openchip";
    const c = "Kalray étend son partenariat avec Openchip pour 5 millions d'euros";
    const opts = { exclude: ["Kalray"], sameCategory: true };
    expect(titleAffinity(a, b, opts)).toBeGreaterThanOrEqual(0.5);
    expect(titleAffinity(a, c, opts)).toBeGreaterThanOrEqual(0.5);
    expect(titleAffinity(b, c, opts)).toBeGreaterThanOrEqual(0.5);
    // Même entreprise, même catégorie, mais partenaire et montant différents : pas de regroupement.
    expect(
      titleAffinity(a, "Kalray signe un accord de distribution avec Arrow pour 2 M€", opts),
    ).toBeLessThan(0.5);
    expect(titleAffinity(a, "Kalray recrute vingt ingénieurs à Montbonnot", opts)).toBeLessThan(
      0.3,
    );
    // Deux levées de montants différents, mots proches : au mieux « fusion incertaine », jamais fusionnées.
    expect(
      titleAffinity(
        "Pasqal boucle une série C de 85 millions d'euros",
        "Pasqal annonce une levée de fonds de série B de 100 millions d'euros",
        { exclude: ["Pasqal"], sameCategory: true },
      ),
    ).toBeLessThan(0.5);
  });

  it("regroupe sur la date de l'événement, pas sur celle de la création du signal", () => {
    const signal = {
      id: "sig_a",
      companyId: "co_kalray",
      category: "partenariat" as const,
      title: "Kalray prolonge de 12 mois son accord avec Openchip pour environ 5 M€",
      createdAt: NOW.toISOString(),
      eventDate: null,
      publishedAt: new Date(NOW.getTime() - 11 * DAY).toISOString(),
    };
    const obs = {
      companyId: "co_kalray",
      title: "Kalray : extension du partenariat avec Openchip",
      excerpt: "Kalray a annoncé l'extension de son partenariat avec Openchip.",
      collectedAt: NOW.toISOString(),
      publishedAt: new Date(NOW.getTime() - 12 * DAY).toISOString(),
    };
    const decision = decideCluster(obs, "partenariat", [{ signal, observations: [] }], ["Kalray"]);
    expect(decision.kind).toBe("attach");
    // Sans date de publication connue sur le signal, la création (12 jours plus tard) sort de la fenêtre.
    expect(
      decideCluster(
        obs,
        "partenariat",
        [{ signal: { ...signal, publishedAt: null }, observations: [] }],
        ["Kalray"],
      ).kind,
    ).toBe("new");
  });
});

describe("pages de rubrique et de pagination", () => {
  it("reconnaît les pages qui citent l'entreprise sans parler d'elle", () => {
    expect(
      looksLikeIndexPage(
        "Innovation - Le Dauphiné Libéré",
        "https://www.ledauphine.com/innovation",
      ),
    ).toBe(true);
    expect(
      looksLikeIndexPage(
        "Network Technology recent news | page 970 of 1107 | Light Reading",
        "https://www.lightreading.com/network-technology?page=970",
      ),
    ).toBe(true);
    expect(
      looksLikeIndexPage("Thématique barrage", "https://www.veille-eau.com/thematique/barrage"),
    ).toBe(true);
    expect(looksLikeIndexPage("Actualités", "https://www.example.com/actualites/")).toBe(true);
    expect(looksLikeIndexPage("Kalray", "https://www.lesechos.fr/tag/kalray")).toBe(true);
    expect(
      looksLikeIndexPage(
        "Résultats de recherche : Kalray",
        "https://www.lesechos.fr/recherche?q=kalray",
      ),
    ).toBe(true);
    expect(
      looksLikeIndexPage(
        "Kalray prolonge de 12 mois son accord avec Openchip pour environ 5 M€",
        "https://www.ideal-investisseur.fr/article/kalray-openchip-12345",
      ),
    ).toBe(false);
    expect(
      looksLikeIndexPage(
        "Un feu vert (enfin) pour l'hydrolien : les industriels doivent-ils croire à ces promesses ?",
        "https://actu.fr/normandie/hydrolien-feu-vert_123.html",
      ),
    ).toBe(false);
    expect(
      looksLikeIndexPage(
        "Kalray - Les Echos",
        "https://www.lesechos.fr/tech/kalray-leve-20-millions",
      ),
    ).toBe(true);
  });
});

describe("regroupement : collecte", () => {
  beforeEach(() => setup());
  afterEach(teardown);

  const outlet = (name: string, domain: string) => ({
    name,
    domain,
    brand: { initials: name[0]!, bg: "#111", fg: "#fff" },
  });

  it("réunit en un signal trois médias qui titrent différemment le même accord", async () => {
    const items: RawItem[] = [
      {
        url: "https://www.ideal-investisseur.fr/kalray-openchip-prolongation",
        title: "Pasqal prolonge de 12 mois son accord avec Openchip pour environ 5 M€",
        html: "<p>Pasqal a décidé de prolonger de 12 mois son accord avec Openchip, pour un montant d'environ 5 M€.</p>",
        outlet: outlet("Idéal Investisseur", "ideal-investisseur.fr"),
        publishedAt: new Date(NOW.getTime() - 11 * DAY).toISOString(),
        eventDate: null,
        via: "google_news",
      },
      {
        url: "https://www.boursier.com/kalray-extension-partenariat",
        title: "Pasqal : extension du partenariat avec Openchip",
        html: "<p>Pasqal a annoncé l'extension de son partenariat avec Openchip autour des processeurs.</p>",
        outlet: outlet("Boursier.com", "boursier.com"),
        publishedAt: new Date(NOW.getTime() - 12 * DAY).toISOString(),
        eventDate: null,
        via: "google_news",
      },
      {
        url: "https://www.boursedirect.fr/kalray-etend-partenariat",
        title: "Pasqal étend son partenariat avec Openchip pour 5 millions d'euros",
        html: "<p>Pasqal annonce l'extension de son partenariat avec Openchip, un contrat de 5 millions d'euros sur un an.</p>",
        outlet: outlet("Bourse Direct", "boursedirect.fr"),
        publishedAt: new Date(NOW.getTime() - 12 * DAY).toISOString(),
        eventDate: null,
        via: "google_news",
      },
    ];
    setAdapters({ collector: { name: "stub", collect: () => ({ ok: true, items }) } });
    const sources = await call<Source[]>("GET", "/sources?companyId=co_pasqal");
    const src = sources.body.find((s) => s.type === "communiques")!;
    const run = await call<CollectionRun>("POST", `/sources/${src.id}/collect`);
    expect(run.body).toMatchObject({ status: "succes", newObservations: 3 });

    const list = await call<Paginated<Signal>>("GET", "/signals?q=Openchip&status=tous&limit=50");
    expect(list.body.items).toHaveLength(1);
    const detail = await call<SignalDetail>("GET", `/signals/${list.body.items[0]!.id}`);
    expect(detail.body.observations).toHaveLength(3);
    expect(detail.body.category).toBe("partenariat");
    expect(detail.body.evidence.independentCorroborations).toBeGreaterThanOrEqual(2);
    expect(detail.body.review).toBeNull();
  });
});
