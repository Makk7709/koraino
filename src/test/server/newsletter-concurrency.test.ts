import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ApiErrorBody, NewsletterEdition } from "@/lib/api/types";
import { getRepository } from "@/server/store/memory";
import { commitEdition, touchEdition } from "@/server/services/newsletters";
import { call, setup, teardown, USERS, NOW } from "./helpers";

beforeEach(() => setup());
afterEach(teardown);
const path = "/newsletters/nl_current";
const read = async () => (await call<NewsletterEdition>("GET", path)).body;
const expected = (e: NewsletterEdition) => ({ version: e.version, revision: e.revision });
const edit = (e: NewsletterEdition, intro: string) =>
  call<NewsletterEdition>("PATCH", path, {
    user: USERS.redacteur,
    body: { ...expected(e), intro },
  });
const approve = (e: NewsletterEdition) =>
  call<NewsletterEdition>("POST", `${path}/approve`, {
    user: USERS.validateur,
    body: expected(e),
  });
const record = (e: NewsletterEdition) =>
  call<NewsletterEdition>("POST", `${path}/export`, {
    user: USERS.validateur,
    body: expected(e),
  });

describe("P0-01 newsletter compare-and-swap", () => {
  it("rejects one of two edits from the same displayed revision", async () => {
    const edition = await read();
    const results = await Promise.all(
      ["Résumé A", "Résumé B"].map((summary, i) =>
        call<NewsletterEdition>("PATCH", path, {
          user: i === 0 ? USERS.redacteur : USERS.admin,
          body: { ...expected(edition), items: [{ ...edition.items[0], summary }] },
        }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await read()).toEqual(results.find((r) => r.status === 200)!.body);
  });

  it("rejects a sequential stale write and preserves the winner", async () => {
    const before = await read();
    const first = await edit(before, "Introduction A");
    expect(first.status).toBe(200);
    const stale = await edit(before, "Introduction B");
    expect(stale.status).toBe(409);
    expect(await read()).toEqual(first.body);
  });

  it("requires both version and revision on all mutation routes", async () => {
    for (const [method, suffix, body] of [
      ["PATCH", "", { intro: "x" }],
      ["POST", "/approve", { version: 6 }],
      ["POST", "/export", {}],
      ["POST", "/items", { signalId: "sig_pasqal" }],
      ["DELETE", `/items/${(await read()).items[0]!.id}`, {}],
    ] as const) {
      const result = await call(method, path + suffix, { body, user: USERS.admin });
      expect(result.status, `${method} ${suffix}`).toBe(400);
    }
  });

  it("approval changes the revision even when editorial version stays the same", async () => {
    const before = await read();
    const approved = await approve(before);
    expect(approved.status).toBe(200);
    expect(approved.body.version).toBe(before.version);
    expect(approved.body.revision).toBe(before.revision + 1);
    expect((await edit(before, "Old tab")).status).toBe(409);
    const edited = await edit(approved.body, "Intentional edit");
    expect(edited.status).toBe(200);
    expect(edited.body.approval?.valid).toBe(false);
    expect(edited.body.status).toBe("composition");
  });

  it("serializes edit versus approval and two approvals", async () => {
    const before = await read();
    const race = await Promise.all([edit(before, "New intro"), approve(before)]);
    expect(race.map((r) => r.status).sort()).toEqual([200, 409]);
    const current = await read();
    if (current.status === "composition") {
      const approvals = await Promise.all([approve(current), approve(current)]);
      expect(approvals.map((r) => r.status).sort()).toEqual([200, 409]);
    }
    const stored = await read();
    expect(stored.approval?.version).toBe(stored.version);
  });

  it("stores exactly one export and one audit for concurrent and repeated requests", async () => {
    const edition = (await approve(await read())).body;
    const responses = await Promise.all([record(edition), record(edition)]);
    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    expect(responses[0]!.body).toEqual(responses[1]!.body);
    expect((await record(edition)).status).toBe(200);
    const repo = await getRepository();
    expect(
      (await repo.publications.list()).filter((p) => p.newsletterId === edition.id),
    ).toHaveLength(1);
    expect(
      (await repo.audit.list()).filter(
        (a) => a.action === "publication.success" && a.entityId === edition.id,
      ),
    ).toHaveLength(1);
    expect((await edit(responses[0]!.body, "After export")).status).toBe(409);
  });

  it("refuses export after content invalidates approval and refuses stale downloads", async () => {
    const approved = (await approve(await read())).body;
    const edited = (await edit(approved, "Changed after approval")).body;
    expect((await record(approved)).status).toBe(409);
    const blocked = await call<ApiErrorBody>("POST", `${path}/export`, {
      user: USERS.validateur,
      body: expected(edited),
    });
    expect(blocked.body.error.code).toBe("approval_missing");
    const download = await call(
      "GET",
      `${path}/export?version=${approved.version}&revision=${approved.revision}`,
    );
    expect(download.status).toBe(409);
  });

  it("rolls back the edition when the audit cannot be inserted", async () => {
    const repo = await getRepository();
    const before = (await repo.newsletters.get("nl_current"))!;
    const existing = (await repo.audit.list())[0]!;
    await expect(
      repo.newsletterMutations.commit({
        before,
        after: touchEdition({ ...before, intro: "Must roll back" }, NOW),
        audit: existing,
        publication: null,
      }),
    ).rejects.toThrow("Duplicate newsletter audit");
    expect(await repo.newsletters.get(before.id)).toEqual(before);
  });

  it("an expired application lease cannot permit an old writer to overwrite newer state", async () => {
    const repo = await getRepository();
    const before = (await repo.newsletters.get("nl_current"))!;
    const user = (await repo.users.get(USERS.redacteur))!;
    const key = `newsletter-write:${before.id}`;
    const oldToken = await repo.acquireLock(key, -1);
    const successor = await repo.acquireLock(key, 10_000);
    expect(successor).not.toBe(oldToken);
    const ctx = { repo, user, now: NOW };
    const next = touchEdition({ ...before, intro: "Successor" }, NOW);
    await commitEdition(ctx, before, next, "newsletter.update", "Successor");
    await expect(
      commitEdition(
        ctx,
        before,
        touchEdition({ ...before, intro: "Stale" }, NOW),
        "newsletter.update",
        "Stale",
      ),
    ).rejects.toMatchObject({ status: 409, code: "version_mismatch" });
    expect(await repo.newsletters.get(before.id)).toEqual(next);
  });

  it("rejects a signal mutation retaining an obsolete approval, atomically", async () => {
    await approve(await read());
    const repo = await getRepository();
    const before = (await repo.newsletters.get("nl_current"))!;
    await expect(
      repo.signalMutations.commit([
        {
          collection: "newsletters",
          id: before.id,
          before,
          after: { ...before, items: before.items.slice(1), revision: (before.revision ?? 0) + 1 },
        },
      ]),
    ).rejects.toThrow("invalidate approval");
    expect(await repo.newsletters.get(before.id)).toEqual(before);
  });

  it.each([false, true])(
    "merge invalidates approval or refuses an exported edition (exported=%s)",
    async (exported) => {
      const approved = (await approve(await read())).body;
      if (exported) await record(approved);
      const repo = await getRepository();
      const template = (await repo.signals.get("sig_pasqal"))!;
      const target = { ...template, id: "nl_merge_target", articleId: null, observationIds: [] };
      const source = { ...template, id: "nl_merge_source", articleId: null, observationIds: [] };
      await repo.signals.insert(target);
      await repo.signals.insert(source);
      const edition = (await repo.newsletters.get("nl_current"))!;
      const fixture = {
        ...edition,
        items: [{ ...edition.items[0]!, signalId: source.id, articleId: null }],
      };
      await repo.newsletters.update(fixture);
      const response = await call("POST", `/signals/${target.id}/merge`, {
        user: USERS.redacteur,
        body: { otherIds: [source.id] },
      });
      if (exported) {
        expect(response.status).toBe(409);
        expect(await repo.newsletters.get(edition.id)).toEqual(fixture);
        expect(await repo.signals.get(source.id)).toEqual(source);
        expect(await repo.signals.get(target.id)).toEqual(target);
      } else {
        expect(response.status).toBe(200);
        const current = (await repo.newsletters.get(edition.id))!;
        expect(current.items[0]!.signalId).toBe(target.id);
        expect(current.version).toBe(edition.version + 1);
        expect(current.revision).toBe((edition.revision ?? 0) + 1);
        expect(current.approval?.valid).toBe(false);
        expect(current.status).toBe("composition");
      }
    },
  );
});
