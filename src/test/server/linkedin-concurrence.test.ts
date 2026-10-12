import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiErrorBody, AuditEvent, LinkedInPost, PublicationAttempt } from "@/lib/api/types";
import { setClock } from "@/server/clock";
import { idempotencyKey } from "@/server/domain/workflow";
import { setLinkedInUserPublisherForTests } from "@/server/handlers/distribution";
import type { Repository } from "@/server/store/repository";
import { call, NOW, setup, teardown, USERS } from "./helpers";

type Publisher = NonNullable<Parameters<typeof setLinkedInUserPublisherForTests>[0]>;
type PublishResult = Awaited<ReturnType<Publisher>>;

const { admin: ADMIN, validateur: VALIDATOR, redacteur: EDITOR, lecteur: READER } = USERS;
const POST_ID = "li_pasqal";
const PUBLISH = `/linkedin/${POST_ID}/publish`;
const IN_PROGRESS_MESSAGE =
  "Une publication de ce post est déjà en cours. Patientez quelques secondes puis actualisez.";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Publieur factice : chaque appel reste suspendu jusqu'à `settle` / `fail`. */
function controlledPublisher() {
  const calls: { userId: string; commentary: string }[] = [];
  let pending = deferred<PublishResult>();
  let started = deferred<void>();
  const secondCall = deferred<null>();
  const fn: Publisher = (userId, commentary) => {
    calls.push({ userId, commentary });
    if (calls.length === 2) secondCall.resolve(null);
    const current = pending;
    started.resolve();
    return current.promise;
  };
  return {
    fn,
    calls,
    started: () => started.promise,
    /** Résolu au deuxième appel : sert à faire échouer vite un test de doublon. */
    secondCall: secondCall.promise,
    settle(result: PublishResult) {
      const current = pending;
      pending = deferred();
      started = deferred();
      current.resolve(result);
    },
    fail(error: unknown) {
      const current = pending;
      pending = deferred();
      started = deferred();
      current.reject(error);
    },
  };
}

let repo: Repository;

beforeEach(() => {
  repo = setup();
});
afterEach(() => {
  setLinkedInUserPublisherForTests(null);
  vi.restoreAllMocks();
  teardown();
});

async function approvePost(): Promise<LinkedInPost> {
  const post = (await call<LinkedInPost[]>("GET", "/linkedin")).body.find((p) => p.id === POST_ID)!;
  const approved = await call<LinkedInPost>("POST", `/linkedin/${POST_ID}/approve`, {
    body: { version: post.version },
    user: VALIDATOR,
  });
  expect(approved.status).toBe(200);
  return approved.body;
}

const publish = (user: string = VALIDATOR, body?: { resolution: string }) =>
  call<PublicationAttempt & ApiErrorBody>("POST", PUBLISH, {
    user,
    ...(body ? { body } : {}),
  });

/** Tentatives du post, de la plus ancienne à la plus récente. */
async function attemptsFor() {
  const list = await call<PublicationAttempt[]>("GET", "/publications?channel=linkedin");
  return list.body.filter((p) => p.linkedinPostId === POST_ID).reverse();
}

async function successes() {
  return (await attemptsFor()).filter((p) => p.status === "succes");
}

function attemptRecord(
  post: LinkedInPost,
  overrides: Partial<PublicationAttempt> & Pick<PublicationAttempt, "id" | "status">,
): PublicationAttempt {
  return {
    idempotencyKey: idempotencyKey(POST_ID, post.version, "linkedin"),
    articleId: post.articleId,
    linkedinPostId: POST_ID,
    newsletterId: null,
    channel: "linkedin",
    version: post.version,
    code: null,
    message: "",
    attempts: 1,
    remoteId: null,
    mode: "publication",
    at: NOW.toISOString(),
    by: "Sophie Martin",
    ...overrides,
  };
}

const lockKeyOf = (post: LinkedInPost) => `linkedin-publish:${POST_ID}:v${post.version}`;

describe("publication LinkedIn : demandes simultanées", () => {
  it("deux POST simultanés : un seul appel à LinkedIn, l'autre reçoit 409, puis rejeu", async () => {
    const publisher = controlledPublisher();
    setLinkedInUserPublisherForTests(publisher.fn);
    await approvePost();

    const first = publish(VALIDATOR);
    const second = publish(ADMIN);
    await publisher.started();
    const loser = await Promise.race([first, second, publisher.secondCall]);
    expect(publisher.calls).toHaveLength(1);
    expect(loser?.status).toBe(409);
    expect(loser?.body.error).toMatchObject({
      code: "publication_in_progress",
      message: IN_PROGRESS_MESSAGE,
    });
    expect(publisher.calls).toHaveLength(1);

    publisher.settle({ kind: "published", remoteId: "urn:li:share:7001" });
    const results = await Promise.all([first, second]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const winner = results.find((r) => r.status === 201)!;
    expect(winner.body).toMatchObject({
      status: "succes",
      mode: "publication",
      remoteId: "urn:li:share:7001",
    });

    const replay = await publish(ADMIN);
    expect(replay.status).toBe(200);
    expect(replay.body.id).toBe(winner.body.id);
    expect(publisher.calls).toHaveLength(1);
    expect(await attemptsFor()).toEqual([expect.objectContaining({ id: winner.body.id })]);
    const posts = await call<LinkedInPost[]>("GET", "/linkedin");
    expect(posts.body.find((p) => p.id === POST_ID)!.status).toBe("publie");
  });

  it("l'export (compte non relié) passe aussi sous le verrou", async () => {
    const publisher = controlledPublisher();
    setLinkedInUserPublisherForTests(publisher.fn);
    await approvePost();

    const first = publish();
    const second = publish();
    await publisher.started();
    const loser = await Promise.race([first, second, publisher.secondCall]);
    expect(publisher.calls).toHaveLength(1);
    expect(loser?.status).toBe(409);
    publisher.settle({ kind: "not_connected" });
    const results = await Promise.all([first, second]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(results.find((r) => r.status === 201)!.body).toMatchObject({
      status: "succes",
      mode: "export",
    });
    expect(publisher.calls).toHaveLength(1);
    expect(await successes()).toHaveLength(1);
  });

  it("après un refus de LinkedIn, le verrou est libéré et une nouvelle tentative publie", async () => {
    const publisher = controlledPublisher();
    setLinkedInUserPublisherForTests(publisher.fn);
    await approvePost();

    const failing = publish();
    await publisher.started();
    publisher.settle({ kind: "api_error", message: "LinkedIn a refusé la publication (500)." });
    const failed = await failing;
    expect(failed.status).toBe(422);
    expect(failed.body.error.code).toBe("linkedin_api_error");

    const retry = publish();
    await publisher.started();
    publisher.settle({ kind: "published", remoteId: "urn:li:share:7002" });
    expect((await retry).status).toBe(201);
    expect(publisher.calls).toHaveLength(2);
    expect((await attemptsFor()).map((a) => a.status)).toEqual(["echec", "succes"]);
  });

  it("une exception du publieur passe la tentative en échec et libère le verrou", async () => {
    const publisher = controlledPublisher();
    setLinkedInUserPublisherForTests(publisher.fn);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await approvePost();

    const crashing = publish();
    await publisher.started();
    const [marker] = await attemptsFor();
    publisher.fail(new Error("clé de connexion illisible"));
    const crashed = await crashing;
    expect(crashed.status).toBe(500);
    expect(crashed.body.error.code).toBe("internal_error");
    expect(errors).toHaveBeenCalled();
    expect(await attemptsFor()).toEqual([
      expect.objectContaining({
        id: marker!.id,
        status: "echec",
        code: "linkedin_internal_error",
      }),
    ]);

    const retry = publish();
    await publisher.started();
    publisher.settle({ kind: "published", remoteId: "urn:li:share:7003" });
    expect((await retry).status).toBe(201);
    expect(publisher.calls).toHaveLength(2);
  });

  it("un verrou abandonné avant tout envoi bloque jusqu'à son expiration", async () => {
    const publisher = controlledPublisher();
    setLinkedInUserPublisherForTests(publisher.fn);
    const post = await approvePost();
    const orphan = await repo.acquireLock(lockKeyOf(post), 120_000);
    expect(orphan).not.toBeNull();

    const blocked = await publish();
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe("publication_in_progress");
    expect(publisher.calls).toHaveLength(0);

    setClock(() => new Date(NOW.getTime() + 120_001));
    const retry = publish();
    await publisher.started();
    publisher.settle({ kind: "published", remoteId: "urn:li:share:7004" });
    expect((await retry).status).toBe(201);
    expect(publisher.calls).toHaveLength(1);
  });

  it("revérifie sous verrou : un succès enregistré entre-temps est rejoué sans appel", async () => {
    const publisher = controlledPublisher();
    setLinkedInUserPublisherForTests(publisher.fn);
    const post = await approvePost();
    const concurrent = attemptRecord(post, {
      id: "pub_concurrent",
      status: "succes",
      message: "Post publié sur LinkedIn via le compte relié.",
      remoteId: "urn:li:share:7005",
    });
    const acquire = repo.acquireLock.bind(repo);
    vi.spyOn(repo, "acquireLock").mockImplementation(async (key, ttlMs) => {
      await repo.publications.insert(concurrent);
      return acquire(key, ttlMs);
    });

    const res = await publish();
    expect(res.status).toBe(200);
    expect(res.body.id).toBe("pub_concurrent");
    expect(publisher.calls).toHaveLength(0);
    expect(await acquire(lockKeyOf(post), 1)).not.toBeNull();
  });

  it("un échec de libération du verrou ne masque pas la publication réussie", async () => {
    const publisher = controlledPublisher();
    setLinkedInUserPublisherForTests(publisher.fn);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(repo, "releaseLock").mockRejectedValue(new Error("base indisponible"));
    await approvePost();

    const pending = publish();
    await publisher.started();
    publisher.settle({ kind: "published", remoteId: "urn:li:share:7006" });
    expect((await pending).status).toBe(201);
    expect(errors).toHaveBeenCalledWith(expect.stringContaining("non libéré"), expect.any(Error));
  });
});

const UNCONFIRMED_MESSAGE =
  "Une publication précédente n'a pas pu être confirmée. Vérifiez sur LinkedIn si le post a bien été publié, puis indiquez-le à KORA.";
const MAYBE_PUBLISHED: PublishResult = {
  kind: "api_error",
  message:
    "LinkedIn est momentanément indisponible (erreur 503) : le post a peut-être été publié malgré tout. Vérifiez votre fil LinkedIn avant de réessayer.",
  verifyBeforeRetry: true,
};

/** Première publication au résultat inconnu : sa tentative reste `verification_requise`. */
async function leaveUnconfirmed(publisher: ReturnType<typeof controlledPublisher>) {
  await approvePost();
  const pending = publish();
  await publisher.started();
  publisher.settle(MAYBE_PUBLISHED);
  const res = await pending;
  expect(res.status).toBe(422);
  return (res.body.error.details as { attempt: PublicationAttempt }).attempt;
}

describe("publication LinkedIn : confirmation du résultat", () => {
  it("enregistre la tentative à vérifier avant l'appel puis la convertit en succès", async () => {
    const publisher = controlledPublisher();
    setLinkedInUserPublisherForTests(publisher.fn);
    await approvePost();

    const pending = publish();
    await publisher.started();
    const during = await attemptsFor();
    expect(during).toEqual([
      expect.objectContaining({
        status: "verification_requise",
        mode: "publication",
        code: "linkedin_confirmation_pending",
        message: "Publication LinkedIn envoyée, confirmation en attente.",
        remoteId: null,
      }),
    ]);

    const url = "https://www.linkedin.com/feed/update/urn:li:share:7101";
    publisher.settle({ kind: "published", remoteId: "urn:li:share:7101", url });
    const res = await pending;
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      id: during[0]!.id,
      status: "succes",
      mode: "publication",
      remoteId: "urn:li:share:7101",
      message: `Post publié sur LinkedIn via le compte relié : ${url}`,
    });
    expect(await attemptsFor()).toEqual([expect.objectContaining({ id: during[0]!.id })]);
  });

  const conversions: [string, PublishResult, number, Partial<PublicationAttempt>][] = [
    [
      "refus de LinkedIn",
      { kind: "api_error", message: "LinkedIn a refusé le contenu du post (erreur 422)." },
      422,
      { status: "echec", mode: "publication", code: "linkedin_api_error" },
    ],
    [
      "autorisation à renouveler",
      { kind: "reconnect_required", message: "Votre autorisation LinkedIn a expiré." },
      422,
      { status: "echec", mode: "publication", code: "linkedin_reconnect_required" },
    ],
    [
      "compte non relié",
      { kind: "not_connected" },
      201,
      { status: "succes", mode: "export", code: "linkedin_api_unavailable", remoteId: null },
    ],
  ];
  it.each(conversions)(
    "%s : la tentative à vérifier devient le résultat (une seule tentative)",
    async (_label, result, status, expected) => {
      const publisher = controlledPublisher();
      setLinkedInUserPublisherForTests(publisher.fn);
      await approvePost();

      const pending = publish();
      await publisher.started();
      const [marker] = await attemptsFor();
      publisher.settle(result);
      const res = await pending;
      expect(res.status).toBe(status);
      expect(await attemptsFor()).toEqual([
        expect.objectContaining({ ...expected, id: marker!.id }),
      ]);
    },
  );

  it("résultat incertain (verifyBeforeRetry) : reste à vérifier et bloque les republications", async () => {
    const publisher = controlledPublisher();
    setLinkedInUserPublisherForTests(publisher.fn);
    const attempt = await leaveUnconfirmed(publisher);
    expect(attempt).toMatchObject({
      status: "verification_requise",
      code: "linkedin_api_error",
      message: MAYBE_PUBLISHED.message,
    });
    expect(await attemptsFor()).toEqual([expect.objectContaining({ id: attempt.id })]);

    for (const user of [VALIDATOR, ADMIN]) {
      const again = await publish(user);
      expect(again.status).toBe(409);
      expect(again.body.error).toMatchObject({
        code: "publication_verification_required",
        message: UNCONFIRMED_MESSAGE,
        details: { attempt: { id: attempt.id, status: "verification_requise" } },
      });
    }
    expect(publisher.calls).toHaveLength(1);
  });

  it("résolution « publié » : succès confirmé, post publié, aucun nouvel appel", async () => {
    const publisher = controlledPublisher();
    setLinkedInUserPublisherForTests(publisher.fn);
    const attempt = await leaveUnconfirmed(publisher);

    const res = await publish(VALIDATOR, { resolution: "published" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: attempt.id,
      status: "succes",
      remoteId: null,
      code: "linkedin_confirmed_by_user",
      message: "Confirmé publié sur LinkedIn par Claire Dubois.",
    });
    expect(publisher.calls).toHaveLength(1);
    expect(await attemptsFor()).toEqual([expect.objectContaining({ id: attempt.id })]);
    const posts = await call<LinkedInPost[]>("GET", "/linkedin");
    expect(posts.body.find((p) => p.id === POST_ID)!.status).toBe("publie");
    const journal = await call<AuditEvent[]>("GET", "/audit?entity=publication");
    expect(journal.body).toContainEqual(
      expect.objectContaining({
        action: "publication.confirmed",
        entityId: attempt.id,
        actor: "Claire Dubois",
      }),
    );

    const replay = await publish(ADMIN);
    expect(replay.status).toBe(200);
    expect(replay.body.id).toBe(attempt.id);
    expect(publisher.calls).toHaveLength(1);
  });

  it("résolution « non publié » : échec consigné puis une seule nouvelle publication", async () => {
    const publisher = controlledPublisher();
    setLinkedInUserPublisherForTests(publisher.fn);
    const attempt = await leaveUnconfirmed(publisher);

    const retry = publish(VALIDATOR, { resolution: "not_published" });
    await publisher.started();
    publisher.settle({ kind: "published", remoteId: "urn:li:share:7102" });
    const res = await retry;
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: "succes", remoteId: "urn:li:share:7102" });
    expect(res.body.id).not.toBe(attempt.id);
    expect(publisher.calls).toHaveLength(2);
    expect(await attemptsFor()).toEqual([
      expect.objectContaining({
        id: attempt.id,
        status: "echec",
        code: "linkedin_absence_confirmed",
        message: "Absence confirmée par Claire Dubois : le post n'était pas sur LinkedIn.",
      }),
      expect.objectContaining({ id: res.body.id, status: "succes" }),
    ]);
    const journal = await call<AuditEvent[]>("GET", "/audit?entity=publication");
    expect(journal.body).toContainEqual(
      expect.objectContaining({ action: "publication.absence_confirmed", entityId: attempt.id }),
    );
  });

  it("Worker tué après l'envoi : refus tant que personne n'a vérifié, jamais de nouvel appel", async () => {
    const publisher = controlledPublisher();
    setLinkedInUserPublisherForTests(publisher.fn);
    const post = await approvePost();
    await repo.publications.insert(
      attemptRecord(post, {
        id: "pub_orphan",
        status: "verification_requise",
        code: "linkedin_confirmation_pending",
        message: "Publication LinkedIn envoyée, confirmation en attente.",
      }),
    );
    expect(await repo.acquireLock(lockKeyOf(post), 120_000)).not.toBeNull();

    const inFlight = await publish();
    expect(inFlight.status).toBe(409);
    expect(inFlight.body.error.code).toBe("publication_in_progress");
    const early = await publish(VALIDATOR, { resolution: "not_published" });
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe("publication_in_progress");

    setClock(() => new Date(NOW.getTime() + 120_001));
    for (const user of [VALIDATOR, ADMIN, VALIDATOR]) {
      const res = await publish(user);
      expect(res.status).toBe(409);
      expect(res.body.error).toMatchObject({
        code: "publication_verification_required",
        details: { attempt: { id: "pub_orphan" } },
      });
    }
    expect(publisher.calls).toHaveLength(0);
    expect((await attemptsFor()).find((a) => a.id === "pub_orphan")).toMatchObject({
      status: "verification_requise",
    });
  });

  it("revérifie sous verrou : une tentative à vérifier apparue entre-temps bloque", async () => {
    const publisher = controlledPublisher();
    setLinkedInUserPublisherForTests(publisher.fn);
    const post = await approvePost();
    const acquire = repo.acquireLock.bind(repo);
    vi.spyOn(repo, "acquireLock").mockImplementation(async (key, ttlMs) => {
      await repo.publications.insert(
        attemptRecord(post, {
          id: "pub_unconfirmed",
          status: "verification_requise",
          code: "linkedin_api_error",
          message: MAYBE_PUBLISHED.message,
        }),
      );
      return acquire(key, ttlMs);
    });

    const res = await publish();
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("publication_verification_required");
    expect(publisher.calls).toHaveLength(0);
    expect((await attemptsFor()).map((a) => a.id)).toEqual(["pub_unconfirmed"]);
    expect(await acquire(lockKeyOf(post), 1)).not.toBeNull();
  });

  it("la résolution exige le droit de publication", async () => {
    const publisher = controlledPublisher();
    setLinkedInUserPublisherForTests(publisher.fn);
    const attempt = await leaveUnconfirmed(publisher);

    for (const user of [EDITOR, READER]) {
      for (const resolution of ["published", "not_published"]) {
        expect((await publish(user, { resolution })).status).toBe(403);
      }
    }
    expect(publisher.calls).toHaveLength(1);
    expect(await attemptsFor()).toEqual([
      expect.objectContaining({ id: attempt.id, status: "verification_requise" }),
    ]);
  });

  it("refuse une résolution sans tentative à vérifier, et un corps invalide", async () => {
    const publisher = controlledPublisher();
    setLinkedInUserPublisherForTests(publisher.fn);
    await approvePost();

    for (const resolution of ["published", "not_published"]) {
      const res = await publish(VALIDATOR, { resolution });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("verification_not_pending");
    }
    const invalid = await publish(VALIDATOR, { resolution: "peut-etre" });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe("validation_error");
    expect(publisher.calls).toHaveLength(0);
    expect(await attemptsFor()).toEqual([]);
  });
});

describe("verrou du dépôt en mémoire", () => {
  it("refuse un second détenteur puis se réacquiert après expiration (horloge de l'app)", async () => {
    const first = await repo.acquireLock("k", 1000);
    expect(first).not.toBeNull();
    expect(await repo.acquireLock("k", 1000)).toBeNull();
    expect(await repo.acquireLock("autre", 1000)).not.toBeNull();

    setClock(() => new Date(NOW.getTime() + 999));
    expect(await repo.acquireLock("k", 1000)).toBeNull();
    setClock(() => new Date(NOW.getTime() + 1000));
    const second = await repo.acquireLock("k", 1000);
    expect(second).not.toBeNull();
    expect(second).not.toBe(first);

    await repo.releaseLock("k", first!);
    expect(await repo.acquireLock("k", 1000)).toBeNull();
    await repo.releaseLock("k", second!);
    expect(await repo.acquireLock("k", 1000)).not.toBeNull();
  });
});
