import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  ApiErrorBody,
  CollectionBatch,
  CollectionRun,
  Notification,
  Paginated,
  ScoringGrid,
  Signal,
  SignalDetail,
  Source,
} from "@/lib/api/types";
import { setAdapters } from "@/server/adapters";
import type { CollectResult, RawItem } from "@/server/adapters/collector";
import { validateWeights } from "@/server/domain/scoring";
import { getRepository } from "@/server/store/memory";
import { call, NOW, setup, teardown, USERS } from "./helpers";

beforeEach(() => setup());
afterEach(teardown);

const ALL = "/signals?status=tous&limit=200";

async function allSignals(): Promise<Signal[]> {
  const out: Signal[] = [];
  for (let offset = 0; ; offset += 200) {
    const page = await call<Paginated<Signal>>("GET", `${ALL}&offset=${offset}`);
    out.push(...page.body.items);
    if (out.length >= page.body.total) return out;
  }
}

function stubCollector(fn: (attempt: number) => CollectResult) {
  setAdapters({ collector: { name: "stub", collect: ({ attempt }) => fn(attempt) } });
}

async function pasqalSource(): Promise<Source> {
  const res = await call<Source[]>("GET", "/sources?companyId=co_pasqal");
  return res.body.find((s) => s.type === "communiques")!;
}

const outlet = (name: string, domain: string) => ({
  name,
  domain,
  brand: { initials: name[0]!, bg: "#111", fg: "#fff" },
});

/* ------------------------------------------------------------------ */

describe("grilles de score", () => {
  it("exige des poids entiers dont la somme vaut 100", async () => {
    expect(
      validateWeights({
        importance: 30,
        nouveaute: 20,
        territoire: 20,
        lecteurs: 20,
        diffusion: 10,
      }),
    ).toBeNull();
    expect(
      validateWeights({
        importance: 30,
        nouveaute: 20,
        territoire: 20,
        lecteurs: 20,
        diffusion: 5,
      }),
    ).toMatch(/100/);
    const res = await call<ApiErrorBody>("POST", "/scoring-grids", {
      body: {
        weights: { importance: 40, nouveaute: 20, territoire: 20, lecteurs: 20, diffusion: 10 },
      },
    });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("weights_sum_invalid");
    const fractional = await call<ApiErrorBody>("POST", "/scoring-grids", {
      body: {
        weights: { importance: 30.5, nouveaute: 19.5, territoire: 20, lecteurs: 20, diffusion: 10 },
      },
    });
    expect(fractional.status).toBe(422);
  });

  it("une nouvelle grille ne réécrit pas l'historique des signaux décidés", async () => {
    const before = await allSignals();
    const created = await call<ScoringGrid>("POST", "/scoring-grids", {
      body: {
        weights: { importance: 10, nouveaute: 10, territoire: 50, lecteurs: 20, diffusion: 10 },
        note: "Priorité territoire",
      },
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ version: 2, active: true, createdBy: "Sophie Martin" });
    const grids = await call<ScoringGrid[]>("GET", "/scoring-grids");
    expect(grids.body.map((g) => [g.version, g.active])).toEqual([
      [2, true],
      [1, false],
    ]);
    expect(grids.body[1]!.weights).toEqual({
      importance: 30,
      nouveaute: 20,
      territoire: 20,
      lecteurs: 20,
      diffusion: 10,
    });

    // Pas de recalcul implicite.
    const unchanged = await allSignals();
    expect(unchanged.map((s) => s.score)).toEqual(before.map((s) => s.score));

    const rescore = await call<{ rescored: number }>("POST", "/signals/rescore");
    expect(rescore.body.rescored).toBeGreaterThan(0);
    const after = new Map((await allSignals()).map((s) => [s.id, s]));
    for (const s of before) {
      const now = after.get(s.id)!;
      if (s.status === "traite" || s.status === "rejete") {
        expect(now.score).toEqual(s.score);
        expect(now.score.gridVersion).toBe(1);
      } else {
        expect(now.score.gridVersion).toBe(2);
        expect(now.score.subScores).toEqual(s.score.subScores);
        const w = created.body.weights;
        const expected = Math.round(
          (s.score.subScores.importance * w.importance +
            s.score.subScores.nouveaute * w.nouveaute +
            s.score.subScores.territoire * w.territoire +
            s.score.subScores.lecteurs * w.lecteurs +
            s.score.subScores.diffusion * w.diffusion) /
            100,
        );
        expect(now.score.total).toBe(expected);
      }
    }
  });
});

/* ------------------------------------------------------------------ */

describe("liste des signaux", () => {
  it("filtre, trie et pagine", async () => {
    const byScore = await call<Paginated<Signal>>("GET", "/signals?status=tous&sort=score&limit=3");
    const scores = byScore.body.items.map((s) => s.score.total);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    const page2 = await call<Paginated<Signal>>(
      "GET",
      "/signals?status=tous&sort=recent&limit=2&offset=2",
    );
    expect(page2.body.items.map((s) => s.id)).toEqual(["sig_wattpark", "sig_sinano"]);
    const company = await call<Paginated<Signal>>(
      "GET",
      "/signals?companyId=co_pasqal&status=tous",
    );
    expect(company.body.items.every((s) => s.companyId === "co_pasqal")).toBe(true);
    const outletFilter = await call<Paginated<Signal>>(
      "GET",
      "/signals?outlet=lesechos.fr&status=tous&limit=200",
    );
    expect(outletFilter.body.items.map((s) => s.id)).toContain("sig_pasqal");
    const theme = await call<Paginated<Signal>>(
      "GET",
      "/signals?theme=deeptech_quantique&status=tous&limit=200",
    );
    expect(theme.body.items.every((s) => s.themes.includes("deeptech_quantique"))).toBe(true);
    const bad = await call<ApiErrorBody>("GET", "/signals?status=inconnu");
    expect(bad.status).toBe(422);
  });

  it("garde une date inconnue à null (jamais inventée)", async () => {
    const all = await allSignals();
    const unknown = all.find((s) => s.publishedAt === null && s.eventDate === null && s.companyId);
    expect(unknown).toBeDefined();
    const detail = await call<SignalDetail>("GET", `/signals/${unknown!.id}`);
    expect(detail.body.publishedAt).toBeNull();
    expect(detail.body.eventDate).toBeNull();
    expect(
      detail.body.observations.every((o) => o.publishedAt === null && o.eventDate === null),
    ).toBe(true);
    expect(detail.body.evidence.freshnessDays).toBeNull();
    expect(detail.body.score.reasons.nouveaute).toMatch(/date de l'événement inconnue/);
  });

  it("présente l'indicateur de preuve sans compter les reprises comme corroborations", async () => {
    const detail = await call<SignalDetail>("GET", "/signals/sig_pasqal");
    expect(detail.body.observations).toHaveLength(4);
    expect(
      detail.body.observations.filter((o) => o.isSyndicated).map((o) => o.outlet.name),
    ).toEqual(["Le Dauphiné Libéré"]);
    expect(detail.body.evidence).toMatchObject({
      level: "solide",
      directSource: true,
      independentCorroborations: 2,
    });
    expect(detail.body.inNewsletter).toBe(true);
  });

  it("exige un motif pour rejeter un signal et journalise la décision", async () => {
    const noReason = await call<ApiErrorBody>("PATCH", "/signals/sig_araymond", {
      body: { status: "rejete" },
    });
    expect(noReason.status).toBe(422);
    expect(noReason.body.error.code).toBe("reason_required");
    const ok = await call<Signal>("PATCH", "/signals/sig_araymond", {
      body: { status: "rejete", statusReason: "Hors ligne éditoriale" },
    });
    expect(ok.body).toMatchObject({ status: "rejete", statusReason: "Hors ligne éditoriale" });
    const audit = await call<{ action: string; details: string }[]>(
      "GET",
      "/audit?entity=signal&entityId=sig_araymond",
    );
    expect(audit.body[0]).toMatchObject({ action: "signal.status" });
    expect(audit.body[0]!.details).toContain("Hors ligne éditoriale");
  });
});

/* ------------------------------------------------------------------ */

describe("collecte WF1 : dédoublonnage, regroupement, rattachement", () => {
  it("dédoublonne les URL, regroupe les reprises et crée un signal pour un nouvel événement", async () => {
    const source = await pasqalSource();
    const before = await call<SignalDetail>("GET", "/signals/sig_pasqal");
    const copy = before.body.observations.find((o) => o.outlet.domain === "pasqal.com")!;
    const items: RawItem[] = [
      {
        url: `${before.body.observations[0]!.url}?utm_source=newsletter`,
        title: before.body.observations[0]!.title,
        html: `<p>${before.body.observations[0]!.excerpt}</p>`,
        outlet: before.body.observations[0]!.outlet,
        publishedAt: null,
        eventDate: null,
      },
      {
        url: "https://www.lefigaro.fr/societes/pasqal-annonce-une-levee-de-fonds-de-serie-b",
        title: "Pasqal annonce une levée de fonds de série B",
        html: `<p>${copy.excerpt}</p>`,
        outlet: outlet("Le Figaro", "lefigaro.fr"),
        publishedAt: new Date(NOW.getTime() - 3_600_000).toISOString(),
        eventDate: null,
      },
      {
        url: "https://www.pasqal.com/fr/actualites/nouveau-site-industriel",
        title: "Pasqal inaugure un site industriel à Massy pour produire ses processeurs",
        html: "<p>Pasqal inaugure un nouveau site industriel et prévoit 80 recrutements d'ingénieurs.</p>",
        outlet: outlet("Pasqal", "pasqal.com"),
        publishedAt: null,
        eventDate: null,
      },
    ];
    stubCollector(() => ({ ok: true, items }));
    const run = await call<CollectionRun>("POST", `/sources/${source.id}/collect`);
    expect(run.status).toBe(200);
    expect(run.body).toMatchObject({ status: "succes", newObservations: 2, errorCode: null });

    const after = await call<SignalDetail>("GET", "/signals/sig_pasqal");
    expect(after.body.observations).toHaveLength(5);
    const figaro = after.body.observations.find((o) => o.outlet.domain === "lefigaro.fr")!;
    expect(figaro.isSyndicated).toBe(true);
    expect(after.body.evidence.independentCorroborations).toBe(
      before.body.evidence.independentCorroborations,
    );

    const fresh = await call<Paginated<Signal>>(
      "GET",
      "/signals?companyId=co_pasqal&status=nouveau&sort=recent",
    );
    const created = fresh.body.items.find((s) => s.title.startsWith("Pasqal inaugure"))!;
    expect(created).toBeDefined();
    expect(created.publishedAt).toBeNull();
    expect(created.score.gridVersion).toBe(1);
    expect(created.matchConfidence).toBe(97);
  });

  it("laisse « à rattacher » une observation dont la confiance de rattachement est < 60", async () => {
    const source = await pasqalSource();
    stubCollector(() => ({
      ok: true,
      items: [
        {
          url: "https://www.placegrenet.fr/2026/10/12/un-nouveau-tiers-lieu-a-meylan",
          title: "Un nouveau tiers-lieu ouvre à Meylan",
          html: "<p>Un tiers-lieu dédié à l'entrepreneuriat ouvre ses portes à Meylan.</p>",
          outlet: outlet("Place Gre'net", "placegrenet.fr"),
          publishedAt: null,
          eventDate: null,
        },
      ],
    }));
    await call("POST", `/sources/${source.id}/collect`);
    const list = await call<Paginated<Signal>>("GET", "/signals?q=tiers-lieu&status=tous");
    const signal = list.body.items[0]!;
    expect(signal.companyId).toBeNull();
    expect(signal.matchConfidence).toBeLessThan(60);
    expect(signal.review?.kind).toBe("homonymie");
    const attached = await call<Signal>("PATCH", `/signals/${signal.id}`, {
      body: { companyId: "co_pasqal" },
    });
    expect(attached.body).toMatchObject({
      companyId: "co_pasqal",
      matchConfidence: 100,
      review: null,
    });
  });

  it("ne réessaie pas un échec définitif, consigne l'échec et notifie", async () => {
    const source = await pasqalSource();
    let calls = 0;
    stubCollector(() => {
      calls += 1;
      return { ok: false, code: "HTTP_403", reason: "Accès refusé par le site", transient: false };
    });
    const run = await call<CollectionRun>("POST", `/sources/${source.id}/collect`);
    expect(calls).toBe(1);
    expect(run.body).toMatchObject({ status: "echec", errorCode: "HTTP_403", newObservations: 0 });
    const sources = await call<Source[]>("GET", "/sources?companyId=co_pasqal");
    expect(sources.body.find((s) => s.id === source.id)).toMatchObject({
      access: "erreur",
      attempts: 1,
      failureCode: "HTTP_403",
    });
    const notifications = await call<Notification[]>("GET", "/notifications");
    expect(notifications.body[0]).toMatchObject({ kind: "erreur_source", read: false });

    calls = 0;
    stubCollector(() => {
      calls += 1;
      return { ok: false, code: "TIMEOUT", reason: "Délai dépassé", transient: true };
    });
    const exhausted = await call<CollectionRun>("POST", `/sources/${source.id}/collect`);
    expect(calls).toBe(3);
    expect(exhausted.body).toMatchObject({ status: "echec", errorCode: "TIMEOUT" });
    const stillFailing = await call<Source[]>("GET", "/sources?companyId=co_pasqal");
    expect(stillFailing.body.find((s) => s.id === source.id)).toMatchObject({ attempts: 3 });

    calls = 0;
    stubCollector((attempt) =>
      attempt === 1
        ? { ok: false, code: "TIMEOUT", reason: "Délai dépassé", transient: true }
        : { ok: true, items: [] },
    );
    const retry = await call<CollectionRun>("POST", `/sources/${source.id}/collect`);
    expect(retry.body.status).toBe("succes_sans_actualite");
    const healed = await call<Source[]>("GET", "/sources?companyId=co_pasqal");
    expect(healed.body.find((s) => s.id === source.id)).toMatchObject({
      access: "ok",
      attempts: 0,
      failureCode: null,
    });
  });

  it("collecte toutes les sources actives par lots, avec le collecteur simulé", async () => {
    const active = (await call<Source[]>("GET", "/sources")).body.filter(
      (s) => s.access !== "desactivee",
    );
    const first = await call<CollectionBatch>("POST", "/collect", { body: { limit: 25 } });
    expect(first.status).toBe(200);
    expect(first.body.total).toBe(active.length);
    expect(first.body.runs).toHaveLength(25);
    expect(first.body.remaining).toBe(active.length - 25);

    const runs = [...first.body.runs];
    let batch = first.body;
    let batches = 1;
    while (batch.remaining > 0) {
      const next = await call<CollectionBatch>("POST", "/collect", {
        body: { since: batch.since, limit: 25 },
      });
      expect(next.body.since).toBe(first.body.since);
      expect(next.body.remaining).toBeLessThan(batch.remaining);
      batch = next.body;
      runs.push(...batch.runs);
      batches += 1;
    }
    expect(batches).toBe(Math.ceil(active.length / 25));
    expect(runs.length).toBe(active.length);
    expect(new Set(runs.map((r) => r.sourceId)).size).toBe(active.length);
    expect(runs.length).toBeGreaterThanOrEqual(250);
    const statuses = new Set(runs.map((r) => r.status));
    expect(statuses.has("echec")).toBe(true);
    expect(statuses.has("succes_sans_actualite")).toBe(true);

    // Un lot de plus avec le même début : plus rien à collecter, aucune exécution.
    const done = await call<CollectionBatch>("POST", "/collect", { body: { since: batch.since } });
    expect(done.body).toMatchObject({ runs: [], remaining: 0 });

    const history = await call<CollectionRun[]>("GET", "/collection-runs?limit=5");
    expect(history.body).toHaveLength(5);
    const audit = await call<{ action: string; details: string }[]>("GET", "/audit?limit=20");
    const lots = audit.body.filter((a) => a.action === "collect.all");
    expect(lots.length).toBeGreaterThanOrEqual(batches);
    expect(lots[0]!.details).toContain("collecte terminée");
  });

  it("refuse un lot mal formé et borne sa taille", async () => {
    const bad = await call<ApiErrorBody>("POST", "/collect", { body: { since: "hier" } });
    expect(bad.status).toBe(400);
    const tooBig = await call<ApiErrorBody>("POST", "/collect", { body: { limit: 500 } });
    expect(tooBig.status).toBe(400);
    const small = await call<CollectionBatch>("POST", "/collect", { body: { limit: 2 } });
    expect(small.body.runs).toHaveLength(2);
    expect(small.body.remaining).toBe(small.body.total - 2);
  });
});

/* ------------------------------------------------------------------ */

describe("fusion et défusion", () => {
  it("défusionne des observations dans un nouveau signal puis les refusionne", async () => {
    const detail = await call<SignalDetail>("GET", "/signals/sig_pasqal");
    const tribune = detail.body.observations.find((o) => o.outlet.domain === "latribune.fr")!;

    const all = await call<ApiErrorBody>("POST", "/signals/sig_pasqal/split", {
      body: { observationIds: detail.body.observationIds },
    });
    expect(all.status).toBe(422);
    const foreign = await call<ApiErrorBody>("POST", "/signals/sig_pasqal/split", {
      body: { observationIds: ["obs_inconnue"] },
    });
    expect(foreign.status).toBe(422);

    const split = await call<{ original: Signal; created: Signal }>(
      "POST",
      "/signals/sig_pasqal/split",
      {
        body: { observationIds: [tribune.id] },
      },
    );
    expect(split.status).toBe(201);
    expect(split.body.created.observationIds).toEqual([tribune.id]);
    expect(split.body.created).toMatchObject({ status: "nouveau", companyId: "co_pasqal" });
    expect(split.body.original.observationIds).not.toContain(tribune.id);
    expect(split.body.original.observationIds).toHaveLength(3);
    expect(split.body.original.evidence.independentCorroborations).toBe(1);

    const merged = await call<Signal>("POST", "/signals/sig_pasqal/merge", {
      body: { otherIds: [split.body.created.id] },
    });
    expect(merged.status).toBe(200);
    expect(merged.body.observationIds).toHaveLength(4);
    expect((await call("GET", `/signals/${split.body.created.id}`)).status).toBe(404);
    expect(merged.body.evidence.independentCorroborations).toBe(2);
  });

  it("refuse de fusionner des signaux d'entreprises différentes", async () => {
    const res = await call<ApiErrorBody>("POST", "/signals/sig_pasqal/merge", {
      body: { otherIds: ["sig_verkor"] },
    });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("company_mismatch");
  });

  it("fusionne un signal incertain avec son jumeau", async () => {
    const repo = await getRepository();
    const uncertain = (await repo.signals.list()).find(
      (s) => s.review?.kind === "fusion_incertaine",
    );
    expect(uncertain).toBeDefined();
    const twin = (await repo.signals.list()).find(
      (s) =>
        s.id !== uncertain!.id &&
        s.companyId === uncertain!.companyId &&
        s.category === uncertain!.category,
    );
    expect(twin).toBeDefined();
    const res = await call<Signal>("POST", `/signals/${twin!.id}/merge`, {
      body: { otherIds: [uncertain!.id] },
    });
    expect(res.status).toBe(200);
    expect(res.body.observationIds.length).toBe(
      twin!.observationIds.length + uncertain!.observationIds.length,
    );
  });

  it("le rédacteur peut fusionner, pas le validateur", async () => {
    const res = await call("POST", "/signals/sig_pasqal/merge", {
      body: { otherIds: ["sig_verkor"] },
      user: USERS.validateur,
    });
    expect(res.status).toBe(403);
  });
});
