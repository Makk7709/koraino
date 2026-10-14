import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  ApiErrorBody,
  Approval,
  ArticleDetail,
  AuditEvent,
  Dashboard,
  EditorialDna,
  EditorialRule,
  PublicationAttempt,
  RuleProposal,
  UsageSnapshot,
} from "@/lib/api/types";
import { UNVERIFIED } from "@/server/adapters/text-model";
import { checkPublishable, idempotencyKey } from "@/server/domain/workflow";
import { call, setup, teardown, USERS } from "./helpers";

beforeEach(() => setup());
afterEach(teardown);

const { redacteur: EDITOR, validateur: VALIDATOR } = USERS;

async function createVerkorArticle() {
  const res = await call<ArticleDetail>("POST", "/articles", {
    body: { signalId: "sig_verkor" },
    user: EDITOR,
  });
  expect(res.status).toBe(201);
  return res.body;
}

describe("WF2 : dossier factuel et brouillon sourcé", () => {
  it("génère un brouillon KORA sourcé depuis un signal et décompte le quota", async () => {
    const usageBefore = await call<UsageSnapshot>("GET", "/usage");
    const art = await createVerkorArticle();
    expect(art).toMatchObject({
      status: "brouillon",
      origin: "kora",
      author: null,
      currentVersion: 1,
      signalId: "sig_verkor",
    });
    expect(art.versions).toHaveLength(1);
    expect(art.versions[0]!.createdBy).toBe("KORA");
    expect(art.factChecks.length).toBeGreaterThan(0);
    const obsIds = new Set(art.observations.map((o) => o.id));
    expect(
      art.factChecks.every(
        (f) => f.observationIds.length > 0 && f.observationIds.every((id) => obsIds.has(id)),
      ),
    ).toBe(true);
    const body = art.versions[0]!.body;
    expect(body).toContain("Sources consultées");
    if (art.factChecks.some((f) => f.status === "non_corrobore"))
      expect(body).toContain(UNVERIFIED);
    expect(art.signal).toMatchObject({ id: "sig_verkor", status: "en_revue", articleId: art.id });

    const again = await call<ApiErrorBody>("POST", "/articles", {
      body: { signalId: "sig_verkor" },
      user: EDITOR,
    });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("article_exists");

    const usageAfter = await call<UsageSnapshot>("GET", "/usage");
    const meter = (u: UsageSnapshot, key: string) => u.meters.find((m) => m.key === key)!.used;
    expect(meter(usageAfter.body, "articles")).toBe(meter(usageBefore.body, "articles") + 1);
    expect(meter(usageAfter.body, "api_budget_eur")).toBeCloseTo(
      meter(usageBefore.body, "api_budget_eur") + 0.45,
      2,
    );
  });

  it("renvoie 404 pour un signal inconnu", async () => {
    const res = await call<ApiErrorBody>("POST", "/articles", {
      body: { signalId: "sig_absent" },
      user: EDITOR,
    });
    expect(res.status).toBe(404);
  });
});

describe("approbation et publication", () => {
  it("bloque la publication sans approbation, sur un autre canal ou après modification", async () => {
    const art = await createVerkorArticle();
    const publish = (channel: string) =>
      call<ApiErrorBody & PublicationAttempt>("POST", `/articles/${art.id}/publish`, {
        body: { channel },
        user: VALIDATOR,
      });

    const none = await publish("wordpress");
    expect(none.status).toBe(422);
    expect(none.body.error.code).toBe("approval_missing");
    const blocked = (none.body.error.details as { attempt: PublicationAttempt }).attempt;
    expect(blocked).toMatchObject({
      status: "bloque",
      attempts: 1,
      version: 1,
      channel: "wordpress",
    });
    const retry = await publish("wordpress");
    expect((retry.body.error.details as { attempt: PublicationAttempt }).attempt).toMatchObject({
      id: blocked.id,
      attempts: 2,
    });

    const early = await call<ApiErrorBody>("POST", `/articles/${art.id}/approve`, {
      body: { channel: "wordpress", version: 1 },
      user: VALIDATOR,
    });
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe("invalid_state");

    const submitted = await call<ArticleDetail>("POST", `/articles/${art.id}/submit`, {
      user: EDITOR,
    });
    expect(submitted.body.status).toBe("en_revue");

    const stale = await call<ApiErrorBody>("POST", `/articles/${art.id}/approve`, {
      body: { channel: "wordpress", version: 2 },
      user: VALIDATOR,
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("version_mismatch");

    const approved = await call<ArticleDetail>("POST", `/articles/${art.id}/approve`, {
      body: { channel: "wordpress", version: 1 },
      user: VALIDATOR,
    });
    expect(approved.body.status).toBe("approuve");
    expect(approved.body.approvals.at(-1)).toMatchObject<Partial<Approval>>({
      version: 1,
      channel: "wordpress",
      approvedBy: "Claire Dubois",
      valid: true,
    });

    const wrongChannel = await publish("linkedin");
    expect(wrongChannel.status).toBe(422);
    expect(wrongChannel.body.error.code).toBe("approval_wrong_channel");

    const edited = await call<ArticleDetail>("POST", `/articles/${art.id}/versions`, {
      body: {
        title: "Verkor accélère sa gigafactory",
        chapo: "Chapô relu.",
        body: "Corps relu par la rédaction.",
      },
      user: EDITOR,
    });
    expect(edited.status).toBe(201);
    expect(edited.body).toMatchObject({
      currentVersion: 2,
      status: "en_revue",
      title: "Verkor accélère sa gigafactory",
    });
    expect(edited.body.approvals.every((a) => !a.valid)).toBe(true);
    expect(edited.body.approvals.at(-1)!.invalidatedReason).toBe(
      "Contenu modifié après approbation",
    );
    expect(edited.body.versions.at(-1)!.createdBy).toBe("Lucas Bernard");

    const invalidated = await publish("wordpress");
    expect(invalidated.status).toBe(422);
    expect(invalidated.body.error.code).toBe("approval_invalidated");
  });

  it("publie un brouillon WordPress distant une seule fois (idempotence)", async () => {
    const art = await createVerkorArticle();
    await call("POST", `/articles/${art.id}/submit`, { user: EDITOR });
    await call("POST", `/articles/${art.id}/approve`, {
      body: { channel: "wordpress", version: 1 },
      user: VALIDATOR,
    });
    const first = await call<PublicationAttempt>("POST", `/articles/${art.id}/publish`, {
      body: { channel: "wordpress" },
      user: VALIDATOR,
    });
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({
      status: "succes",
      mode: "brouillon_distant",
      version: 1,
      by: "Claire Dubois",
    });
    expect(first.body.remoteId).toMatch(/^wp-\d{4}$/);
    expect(first.body.idempotencyKey).toBe(idempotencyKey(art.id, 1, "wordpress"));
    expect(first.body.idempotencyKey).toMatch(/^[0-9a-f]{64}$/);

    const second = await call<PublicationAttempt>("POST", `/articles/${art.id}/publish`, {
      body: { channel: "wordpress" },
      user: VALIDATOR,
    });
    expect(second.status).toBe(200);
    expect(second.body.id).toBe(first.body.id);
    const list = await call<PublicationAttempt[]>("GET", `/publications?articleId=${art.id}`);
    expect(list.body.filter((p) => p.status === "succes")).toHaveLength(1);

    const detail = await call<ArticleDetail>("GET", `/articles/${art.id}`);
    expect(detail.body.wordpress).toMatchObject({
      remoteId: first.body.remoteId,
      status: "brouillon",
    });
    expect(detail.body.status).toBe("approuve");
    expect(detail.body.signal?.status).toBe("traite");
    const audit = await call<AuditEvent[]>("GET", "/audit?limit=20");
    expect(audit.body.map((e) => e.action)).toEqual(
      expect.arrayContaining(["publication.success", "publication.replay", "article.approve"]),
    );
  });

  it("met à jour le brouillon distant existant de Pasqal (approuvé, prêt à publier)", async () => {
    const res = await call<PublicationAttempt>("POST", "/articles/art_pasqal/publish", {
      body: { channel: "wordpress" },
      user: VALIDATOR,
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ remoteId: "wp-4821", version: 2, mode: "brouillon_distant" });
    expect(res.body.message).toContain("mis à jour");
    expect(res.body.message).toContain(
      "Aucune publication : la mise en ligne se fait dans WordPress.",
    );
  });

  it("rejette avec motif et la restauration crée une nouvelle version", async () => {
    const noReason = await call<ApiErrorBody>("POST", "/articles/art_pasqal/reject", {
      body: { reason: "" },
      user: VALIDATOR,
    });
    expect(noReason.status).toBe(400);
    const rejected = await call<ArticleDetail>("POST", "/articles/art_pasqal/reject", {
      body: { reason: "Chiffres à recouper" },
      user: VALIDATOR,
    });
    expect(rejected.body.status).toBe("rejete");
    expect(rejected.body.approvals.every((a) => !a.valid)).toBe(true);

    const restored = await call<ArticleDetail>("POST", "/articles/art_pasqal/restore", {
      body: { version: 1 },
      user: EDITOR,
    });
    expect(restored.status).toBe(201);
    expect(restored.body.currentVersion).toBe(3);
    expect(restored.body.title).toBe(restored.body.versions[0]!.title);
    expect(restored.body.versions.at(-1)!.note).toBe("Restauration de la version 1");
    expect(restored.body.status).toBe("brouillon");
    const dashboard = await call<Dashboard>("GET", "/dashboard");
    expect(dashboard.body.latestWordpressDraft?.ready).toBe(false);
  });

  it("une contradiction non résolue bloque l'approbation jusqu'à son arbitrage", async () => {
    const detail = await call<ArticleDetail>("GET", "/articles/art_contra");
    const contradiction = detail.body.factChecks.find((f) => f.status === "contradictoire");
    expect(contradiction).toBeDefined();
    await call("POST", "/articles/art_contra/submit", { user: EDITOR });
    const blocked = await call<ApiErrorBody>("POST", "/articles/art_contra/approve", {
      body: { channel: "wordpress", version: detail.body.currentVersion },
      user: VALIDATOR,
    });
    expect(blocked.status).toBe(422);
    expect(blocked.body.error.code).toBe("contradiction_unresolved");

    const resolved = await call<ArticleDetail>(
      "PATCH",
      `/articles/art_contra/fact-checks/${contradiction!.id}`,
      {
        body: { status: "etaye", note: "Montant confirmé par le communiqué officiel" },
        user: VALIDATOR,
      },
    );
    expect(resolved.body.factChecks.find((f) => f.id === contradiction!.id)).toMatchObject({
      status: "etaye",
      resolution: { by: "Claire Dubois", note: "Montant confirmé par le communiqué officiel" },
    });
    const approved = await call<ArticleDetail>("POST", "/articles/art_contra/approve", {
      body: { channel: "wordpress", version: detail.body.currentVersion },
      user: VALIDATOR,
    });
    expect(approved.status).toBe(200);
  });

  it("contrôle avant envoi : approbation sur une autre version", () => {
    const approval: Approval = {
      id: "a1",
      version: 1,
      channel: "wordpress",
      approvedBy: "Claire Dubois",
      approvedAt: new Date().toISOString(),
      scheduledAt: null,
      valid: true,
      invalidatedAt: null,
      invalidatedReason: null,
    };
    expect(
      checkPublishable({ approvals: [approval], channel: "wordpress", version: 2 }),
    ).toMatchObject({
      ok: false,
      code: "approval_version_mismatch",
    });
    expect(checkPublishable({ approvals: [approval], channel: "wordpress", version: 1 }).ok).toBe(
      true,
    );
  });
});

describe("WF6 : référentiel éditorial", () => {
  it("propose des règles à partir des corrections et n'applique rien sans décision", async () => {
    const dna = await call<EditorialDna>("GET", "/editorial-dna");
    expect(dna.body.rules.length).toBeGreaterThanOrEqual(8);
    const pending = dna.body.proposals.filter((p) => p.status === "proposee");
    const vocab = pending.find((p) => p.kind === "vocabulaire");
    const length = pending.find((p) => p.kind === "longueur");
    expect(vocab?.proposedText).toBe("Préférer « jeune pousse » à « start-up ».");
    expect(length?.ruleId).toBe("rule_02");
    expect(pending.every((p) => p.basedOnCorrections >= 3)).toBe(true);

    // Une nouvelle correction humaine (titre raccourci) relance l'analyse.
    const art = await createVerkorArticle();
    await call("POST", `/articles/${art.id}/versions`, {
      body: {
        title: "Verkor accélère",
        chapo: art.versions[0]!.chapo,
        body: art.versions[0]!.body,
      },
      user: EDITOR,
    });
    const refreshed = await call<EditorialDna>("GET", "/editorial-dna");
    const lengthNow = refreshed.body.proposals.find((p) => p.id === length!.id)!;
    expect(lengthNow.basedOnCorrections).toBe(length!.basedOnCorrections + 1);

    const accepted = await call<RuleProposal>("PATCH", `/editorial-dna/proposals/${vocab!.id}`, {
      body: { decision: "acceptee" },
    });
    expect(accepted.body).toMatchObject({ status: "acceptee", decidedBy: "Sophie Martin" });
    const twice = await call<ApiErrorBody>("PATCH", `/editorial-dna/proposals/${vocab!.id}`, {
      body: { decision: "refusee" },
    });
    expect(twice.status).toBe(409);
    const lengthAccepted = await call<RuleProposal>(
      "PATCH",
      `/editorial-dna/proposals/${length!.id}`,
      { body: { decision: "acceptee" } },
    );
    expect(lengthAccepted.status).toBe(200);
    const after = await call<EditorialDna>("GET", "/editorial-dna");
    expect(after.body.rules.map((r) => r.text)).toContain(
      "Préférer « jeune pousse » à « start-up ».",
    );
    const rule02 = after.body.rules.find((r) => r.id === "rule_02")!;
    expect(rule02).toMatchObject({
      version: 3,
      text: lengthNow.proposedText,
      updatedBy: "Sophie Martin",
    });
  });

  it("versionne les règles (administration uniquement)", async () => {
    const created = await call<EditorialRule>("POST", "/editorial-dna/rules", {
      body: { kind: "ton", text: "Pas de superlatifs." },
    });
    expect(created.status).toBe(201);
    expect(created.body.version).toBe(1);
    const updated = await call<EditorialRule>("PATCH", `/editorial-dna/rules/${created.body.id}`, {
      body: { active: false },
    });
    expect(updated.body).toMatchObject({ version: 2, active: false });
    const denied = await call("PATCH", `/editorial-dna/rules/${created.body.id}`, {
      body: { active: true },
      user: EDITOR,
    });
    expect(denied.status).toBe(403);
  });
});
