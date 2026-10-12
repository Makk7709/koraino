import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiErrorBody, LinkedInPost, PublicationAttempt } from "@/lib/api/types";
import { setClock } from "@/server/clock";
import { idempotencyKey } from "@/server/domain/workflow";
import { setLinkedInUserPublisherForTests } from "@/server/handlers/distribution";
import type { Repository } from "@/server/store/repository";
import { call, NOW, setup, teardown, USERS } from "./helpers";

type Publisher = NonNullable<Parameters<typeof setLinkedInUserPublisherForTests>[0]>;
type PublishResult = Awaited<ReturnType<Publisher>>;

const { admin: ADMIN, validateur: VALIDATOR } = USERS;
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

const publish = (user: string = VALIDATOR) =>
  call<PublicationAttempt & ApiErrorBody>("POST", PUBLISH, { user });

async function successes() {
  const list = await call<PublicationAttempt[]>("GET", "/publications?channel=linkedin");
  return list.body.filter((p) => p.linkedinPostId === POST_ID && p.status === "succes");
}

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
    expect(await successes()).toHaveLength(1);
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
    expect(await successes()).toHaveLength(1);
  });

  it("une exception du publieur libère aussi le verrou", async () => {
    const publisher = controlledPublisher();
    setLinkedInUserPublisherForTests(publisher.fn);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await approvePost();

    const crashing = publish();
    await publisher.started();
    publisher.fail(new Error("réseau coupé"));
    const crashed = await crashing;
    expect(crashed.status).toBe(500);
    expect(crashed.body.error.code).toBe("internal_error");
    expect(errors).toHaveBeenCalled();

    const retry = publish();
    await publisher.started();
    publisher.settle({ kind: "published", remoteId: "urn:li:share:7003" });
    expect((await retry).status).toBe(201);
    expect(publisher.calls).toHaveLength(2);
  });

  it("un verrou abandonné (Worker interrompu) bloque jusqu'à son expiration", async () => {
    const publisher = controlledPublisher();
    setLinkedInUserPublisherForTests(publisher.fn);
    const post = await approvePost();
    const orphan = await repo.acquireLock(`linkedin-publish:${POST_ID}:v${post.version}`, 120_000);
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
    const concurrent: PublicationAttempt = {
      id: "pub_concurrent",
      idempotencyKey: idempotencyKey(POST_ID, post.version, "linkedin"),
      articleId: post.articleId,
      linkedinPostId: POST_ID,
      newsletterId: null,
      channel: "linkedin",
      version: post.version,
      status: "succes",
      code: null,
      message: "Post publié sur LinkedIn via le compte relié.",
      attempts: 1,
      remoteId: "urn:li:share:7005",
      mode: "publication",
      at: NOW.toISOString(),
      by: "Sophie Martin",
    };
    const acquire = repo.acquireLock.bind(repo);
    vi.spyOn(repo, "acquireLock").mockImplementation(async (key, ttlMs) => {
      await repo.publications.insert(concurrent);
      return acquire(key, ttlMs);
    });

    const res = await publish();
    expect(res.status).toBe(200);
    expect(res.body.id).toBe("pub_concurrent");
    expect(publisher.calls).toHaveLength(0);
    expect(await acquire(`linkedin-publish:${POST_ID}:v${post.version}`, 1)).not.toBeNull();
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
